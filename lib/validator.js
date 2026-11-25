import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { dateAdd } from '../web/table-model.js';
import { parseStrictJson } from './strict-json.js';
import { revisionMatches } from './revision.js';
import { normalizeSubjectName, normalizeSktjfSubjectNames } from '../web/subject-names.js';

const schema=JSON.parse(readFileSync(new URL('../schema/sktjf-v1.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true});
addFormats(ajv);
const shape=ajv.compile(schema);

/** Format validation is necessary, but cannot prove human review or source completeness. */
export function validateSktjf(data, {allowLegacySubjectAliases=true}={}) {
  if(!shape(data))return shape.errors.map(e=>`${e.instancePath||'/'} ${e.message}`);
  const errors=[], unique=(items,key,label)=>{const seen=new Set();for(const item of items){const value=key(item);if(seen.has(value))errors.push(`${label}: 重複 ${value}`);seen.add(value);}return seen;};
  const limit=(items,max,label)=>{if(items.length>max)errors.push(`${label}: 件数が多すぎます`);};
  const text=(value,max,label)=>{if(typeof value!=='string'||!value.trim()||value.length>max)errors.push(`${label}: 文字数または内容が正しくありません`);};
  limit(data.sources,128,'sources');limit(data.lessons,1000,'lessons');limit(data.calendar,370,'calendar');
  text(data.classId,128,'classId');text(data.revision,1024,'revision');
  for(const source of data.sources){
    text(source.name,512,`sources ${source.id}`);
    if(source.url!==undefined){
      text(source.url,2048,`sources ${source.id} URL`);
      try{const url=new URL(source.url);if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.hash)throw Error();}catch{errors.push(`sources ${source.id}: URLが正しくありません`);}
    }
  }
  const sourceIds=unique(data.sources,s=>s.id,'sources'),periods=unique(data.periods,p=>p.number,'periods');
  unique(data.lessons,l=>l.id,'lessons');unique(data.calendar,d=>d.date,'calendar');
  unique(data.slotCoverage,s=>`${s.dayOfWeek}/${s.period}`,'slotCoverage');
  if(!revisionMatches(data.revision,data.academicYear,data.term.code))errors.push('revision: 年度または学期が一致しません');
  const yearStart=`${data.academicYear}-04-01`, yearEnd=`${data.academicYear+1}-03-31`;
  if(data.term.start>data.term.end || data.term.start<yearStart || data.term.end>yearEnd)errors.push('term: 学年度内の日付範囲を指定してください');
  for(const p of data.periods)if(p.start>=p.end)errors.push(`periods ${p.number}: 開始時刻は終了時刻より前にしてください`);
  const ordered=[...data.periods].sort((a,b)=>a.number-b.number);for(let i=1;i<ordered.length;i++)if(ordered[i].start<ordered[i-1].end)errors.push(`periods ${ordered[i].number}: 時刻が重なっています`);
  const refs=(refs,path)=>{limit(refs,128,`${path} sources`);for(const r of refs){if(!sourceIds.has(r.sourceId))errors.push(`${path}: 不明な出典 ${r.sourceId}`);if(r.page>100000)errors.push(`${path}: 出典ページが正しくありません`);if(r.note!==undefined)text(r.note,1024,`${path} note`);}};
  for(const slot of data.slotCoverage){const matching=data.lessons.filter(l=>l.dayOfWeek===slot.dayOfWeek&&l.period===slot.period);if(!periods.has(slot.period))errors.push(`slotCoverage: 不明な時限 ${slot.period}`);if((slot.state==='PRESENT')!==Boolean(matching.length))errors.push(`slotCoverage ${slot.dayOfWeek}/${slot.period}: 授業と状態が一致しません`);if(slot.state==='EMPTY'&&slot.containsExcluded)errors.push(`slotCoverage ${slot.dayOfWeek}/${slot.period}: 枠の状態が矛盾しています`);refs(slot.sources,`slotCoverage ${slot.dayOfWeek}/${slot.period}`);}
  const slotKeys=new Set(data.slotCoverage.map(slot=>`${slot.dayOfWeek}/${slot.period}`));
  for(let day=1;day<=5;day++)for(const period of data.periods)
    if(!slotKeys.has(`${day}/${period.number}`))errors.push(`slotCoverage ${day}/${period.number}: 枠がありません`);
  for(const lesson of data.lessons){
    text(lesson.subject,1000,`lessons ${lesson.id}`);
    if(!allowLegacySubjectAliases&&normalizeSubjectName(lesson.subject)!==lesson.subject)errors.push(`lessons ${lesson.id}: 科目名を「保体」表記にしてください`);
    for(const [label,items] of [['teachers',lesson.teachers],['rooms',lesson.rooms]]){limit(items,64,`lessons ${lesson.id} ${label}`);for(const item of items)text(item,1024,`lessons ${lesson.id} ${label}`);}
    limit(lesson.conditions.all,64,`lessons ${lesson.id} conditions.all`);limit(lesson.conditions.none,64,`lessons ${lesson.id} conditions.none`);
    if(!data.slotCoverage.some(s=>s.dayOfWeek===lesson.dayOfWeek&&s.period===lesson.period))errors.push(`lessons ${lesson.id}: 枠の確認状態がありません`);
    if(!periods.has(lesson.period))errors.push(`lessons ${lesson.id}: 不明な時限 ${lesson.period}`);
    if(lesson.conditions.all.some(x=>lesson.conditions.none.includes(x)))errors.push(`lessons ${lesson.id}: 対象条件が矛盾しています`);
    if(lesson.kind==='MAKEUP'&&lesson.subject!=='補講')errors.push(`lessons ${lesson.id}: 補講の科目名が不正です`);
    if(lesson.kind==='EXTENSION'&&lesson.subject!=='延長枠')errors.push(`lessons ${lesson.id}: 延長枠の科目名が不正です`);
    if(lesson.subject==='補講'&&lesson.kind!=='MAKEUP')errors.push(`lessons ${lesson.id}: 補講の種別が不正です`);
    if(lesson.subject==='延長枠'&&lesson.kind!=='EXTENSION')errors.push(`lessons ${lesson.id}: 延長枠の種別が不正です`);
    if(/※\s*[23３２]/.test(lesson.subject))errors.push(`lessons ${lesson.id}: 脚注を確認してください`);
    if(/[（(][^()（）]*[0-9０-９]+\s*週[^()（）]*[）)]/u.test(lesson.subject))errors.push(`lessons ${lesson.id}: 授業週の適用期間を確認してください`);
    refs(lesson.sources,`lessons ${lesson.id}`);
  }
  for(const day of data.calendar){
    if(day.event)text(day.event.name,1000,`calendar ${day.date} event`);
    if(day.date<data.term.start||day.date>data.term.end)errors.push(`calendar ${day.date}: 学期の範囲外です`);
    if(day.dayType===null&&!day.event)errors.push(`calendar ${day.date}: 日付の内容がありません`);
    if(day.dayType==='HOLIDAY'&&(day.overrideDayOfWeek!=null||day.overrideDayType!=null))errors.push(`calendar ${day.date}: 休日に授業の振替は指定できません`);
    if(day.overrideDayType!=null&&day.overrideDayOfWeek==null)errors.push(`calendar ${day.date}: 振替先の曜日がありません`);
    refs(day.sources,`calendar ${day.date}`);
  }
  if(data.term.start<=data.term.end&&data.term.start>=yearStart&&data.term.end<=yearEnd){
    const dates=new Set(data.calendar.map(day=>day.date));
    for(let date=data.term.start;date<=data.term.end;date=dateAdd(date,1)){
      const weekday=new Date(`${date}T00:00:00Z`).getUTCDay();
      if(weekday>=1&&weekday<=5&&!dates.has(date))errors.push(`calendar ${date}: 日付がありません`);
    }
  }
  return errors;
}
export function parseSktjf(input){const data=parseStrictJson(input,4*1024*1024);const errors=validateSktjf(data);if(errors.length)throw new Error(errors.join('\n'));return data;}
export function serializeSktjf(data){const normalized=normalizeSktjfSubjectNames(data),errors=validateSktjf(normalized,{allowLegacySubjectAliases:false});if(errors.length)throw new Error(errors.join('\n'));const result=`${JSON.stringify(normalized,null,2)}\n`;parseStrictJson(result,4*1024*1024);return result;}
