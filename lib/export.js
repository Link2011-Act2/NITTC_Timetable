import { createHash } from 'node:crypto';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { dateAdd, isoDate, lessonAt, validProject } from '../web/table-model.js';
import { validateSktjf } from './validator.js';

export function scopeApplies(scope, classId) {
  const normalized=scope.normalize('NFKC').replace(/\s/g,'');
  if(normalized===classId)return true;
  const grade=Number(classId[0]);
  if(/^1[・･]2[・･]3年生$/.test(normalized))return grade>=1&&grade<=3;
  if(/^4[・･]5年生$/.test(normalized))return grade===4||grade===5;
  return /^[45](ME|IB)$/.test(normalized) && Number(normalized[0])===grade && normalized.slice(1).includes(classId[1]);
}

/** Fail closed: only explicitly reviewed, completely covered records are converted. */
export async function buildDistribution(project, options) {
  if(!validProject(project))throw new Error('作業ファイルの形式が正しくありません');
  const errors=[];const {term,classId,scope,start,end,periods,revision,coverageConfirmed}=options||{};
  if(!['S','F'].includes(term)||!(/^(1-[1-4]|[2-5][MEIB]|AC-[A-Z0-9]+)$/.test(classId||'')))errors.push('学期またはクラスが正しくありません');
  if(!scope||!scopeApplies(scope,classId||''))errors.push('クラスに対応する隔週表を選択してください');
  const validDate=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;return isoDate(...s.split('-').map(Number))===s;};
  if(!validDate(start)||!validDate(end)||start>end||start<`${project.year}-04-01`||end>`${project.year+1}-03-31`)errors.push('学期の期間が正しくありません');
  if(!Array.isArray(periods)||!periods.length||periods.length>12||periods.some((p,i)=>p.number!==i+1||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.start||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.end||'')||p.start>=p.end))errors.push('授業時刻を確認してください');
  if(!new RegExp(`^${project.year}\\.${term}\\.(0|[1-9][0-9]*)$`).test(revision||''))errors.push('配信リビジョンが正しくありません');
  if(project.legacyCells.length)errors.push('旧形式の未配置データがあります');
  if(project.warnings?.length)errors.push('未解決の確認事項があります');
  if(coverageConfirmed!==true)errors.push('学期の資料をすべて確認してください');
  if(Array.isArray(periods)&&periods.some((p,i)=>i>0&&p.start<periods[i-1].end))errors.push('授業時刻が重なっています');
  if(errors.length)throw new Error(errors.join('\n'));
  const sourceById=new Map(project.sources.map(s=>[s.id,s])),pageCounts=new Map();
  async function reference(c,label){
    const source=sourceById.get(c.sourceId);
    if(!source||!Number.isInteger(c.sourcePage)||c.sourcePage<1){errors.push(`${label}: 出典がありません`);return null;}
    if(!pageCounts.has(source.id)){
      try{
        if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(source.data))throw Error();
        const bytes=Buffer.from(source.data,'base64'),digest=createHash('sha256').update(bytes).digest('hex');
        if(digest!==source.sha256)throw Error();
        const pdf=await pdfjs.getDocument({data:new Uint8Array(bytes)}).promise;pageCounts.set(source.id,pdf.numPages);
      }catch{pageCounts.set(source.id,0);errors.push(`${source.name}: PDFを確認できません`);}
    }
    if(c.sourcePage>pageCounts.get(source.id)){errors.push(`${label}: 出典ページが正しくありません`);return null;}
    return {sourceId:source.id,page:c.sourcePage};
  }
  const coverage=[],lessons=[],calendar=[];
  for(let day=1;day<=5;day++)for(const period of periods){
    const cell=lessonAt(project,term,classId,day,period.number),label=`${'月火水木金'[day-1]}曜${period.number}時限`;
    if(!cell||!cell.reviewed){errors.push(`${label}: 未確認です`);continue;}
    const source=await reference(cell,label);const state=cell.state||(!cell.entries.length?'EMPTY':'PRESENT');
    if(!['PRESENT','EMPTY','EXCLUDED'].includes(state)||((state==='PRESENT')!==Boolean(cell.entries.length))){errors.push(`${label}: 枠の内容を確認してください`);continue;}
    if(cell.containsExcluded&&state==='EMPTY'){errors.push(`${label}: 配信対象外の授業を確認してください`);continue;}
    if(/※\s*[3３]/.test(cell.raw||'')&&state!=='EXCLUDED'&&!cell.containsExcluded){errors.push(`${label}: 配信対象外の授業を確認してください`);continue;}
    if(source)coverage.push({dayOfWeek:day,period:period.number,state,...(cell.containsExcluded?{containsExcluded:true}:{}),sources:[source]});
    for(let i=0;i<cell.entries.length;i++){
      const e=cell.entries[i],original=e.subject.trim(),subject=/^※\s*[2２]$/.test(original)?'延長枠':original,cycle=e.cycle.trim().toUpperCase()||'WEEKLY',attrs=e.attributes.trim()?e.attributes.split(/[,，\s]+/).filter(Boolean):[];
      let kind=(e.special||'').trim().toUpperCase()||'NORMAL';if(subject==='補講'&&kind==='NORMAL')kind='MAKEUP';if(subject==='延長枠'&&kind==='NORMAL')kind='EXTENSION';
      if(!e.id||!subject||!['WEEKLY','A','B'].includes(cycle)||!attrs.every(a=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(a))||!['NORMAL','MAKEUP','EXTENSION'].includes(kind)){errors.push(`${label}: 授業の内容を確認してください`);continue;}
      if(source)lessons.push({id:e.id,dayOfWeek:day,period:period.number,cycle,subject,teachers:e.teacher.trim()?[e.teacher.trim()]:[],rooms:e.room.trim()?[e.room.trim()]:[],conditions:{all:attrs,none:[]},kind,sources:[source]});
    }
  }
  for(let date=start;date<=end;date=dateAdd(date,1)){
    const weekday=new Date(`${date}T00:00:00Z`).getUTCDay();if(weekday<1||weekday>5)continue;
    const cell=project.calendar.find(c=>c.scope===scope&&c.date===date);
    if(!cell||!cell.reviewed){errors.push(`${date}: 日付が未確認です`);continue;}
    const source=await reference(cell,date);let type=cell.dayType.trim().toUpperCase();if(['休日','祝日'].includes(type))type='HOLIDAY';
    if(!['A','B','HOLIDAY',''].includes(type)||(!type&&!cell.label.trim())){errors.push(`${date}: 日付の内容を確認してください`);continue;}
    const day={date,dayType:type||null,sources:source?[source]:[]};
    if(cell.lessonDay)day.overrideDayOfWeek=Number(cell.lessonDay);if(cell.lessonType)day.overrideDayType=cell.lessonType.trim().toUpperCase();
    if(cell.label.trim()){const kind=(cell.eventKind||'OTHER').toUpperCase();day.event={name:cell.label.trim(),kind};}
    if(source)calendar.push(day);
  }
  if(errors.length)throw new Error(errors.join('\n'));
  const used=new Set([...coverage.flatMap(c=>c.sources),...calendar.flatMap(c=>c.sources)].map(r=>r.sourceId));
  const result={format:'SKTJF',schemaVersion:1,schoolId:'nittc',academicYear:project.year,term:{code:term,start,end},classId,revision,sources:project.sources.filter(s=>used.has(s.id)).map(({id,name,sha256})=>({id,name,sha256})),periods,slotCoverage:coverage,lessons,calendar};
  const semantic=validateSktjf(result);if(semantic.length)throw new Error(semantic.join('\n'));return result;
}
