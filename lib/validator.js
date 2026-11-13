import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';

const schema=JSON.parse(readFileSync(new URL('../schema/sktjf-v1.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true});
addFormats(ajv);
const shape=ajv.compile(schema);

/** Format validation is necessary, but cannot prove human review or source completeness. */
export function validateSktjf(data) {
  if(!shape(data))return shape.errors.map(e=>`${e.instancePath||'/'} ${e.message}`);
  const errors=[], unique=(items,key,label)=>{const seen=new Set();for(const item of items){const value=key(item);if(seen.has(value))errors.push(`${label}: 重複 ${value}`);seen.add(value);}return seen;};
  const sourceIds=unique(data.sources,s=>s.id,'sources'),periods=unique(data.periods,p=>p.number,'periods');
  unique(data.lessons,l=>l.id,'lessons');unique(data.calendar,d=>d.date,'calendar');
  if(data.revision!==`${data.academicYear}.${data.term.code}.${data.revision.split('.')[2]}`)errors.push('revision: 年度または学期が一致しません');
  const yearStart=`${data.academicYear}-04-01`, yearEnd=`${data.academicYear+1}-03-31`;
  if(data.term.start>data.term.end || data.term.start<yearStart || data.term.end>yearEnd)errors.push('term: 学年度内の日付範囲を指定してください');
  for(const p of data.periods)if(p.start>=p.end)errors.push(`periods ${p.number}: 開始時刻は終了時刻より前にしてください`);
  const refs=(refs,path)=>{for(const r of refs)if(!sourceIds.has(r.sourceId))errors.push(`${path}: 不明な出典 ${r.sourceId}`);};
  for(const lesson of data.lessons){
    if(!periods.has(lesson.period))errors.push(`lessons ${lesson.id}: 不明な時限 ${lesson.period}`);
    if(lesson.conditions.all.some(x=>lesson.conditions.none.includes(x)))errors.push(`lessons ${lesson.id}: 対象条件が矛盾しています`);
    if(lesson.kind==='MAKEUP'&&lesson.subject!=='補講')errors.push(`lessons ${lesson.id}: 補講の科目名が不正です`);
    if(lesson.kind==='EXTENSION'&&lesson.subject!=='延長枠')errors.push(`lessons ${lesson.id}: 延長枠の科目名が不正です`);
    if(lesson.subject==='補講'&&lesson.kind!=='MAKEUP')errors.push(`lessons ${lesson.id}: 補講の種別が不正です`);
    if(lesson.subject==='延長枠'&&lesson.kind!=='EXTENSION')errors.push(`lessons ${lesson.id}: 延長枠の種別が不正です`);
    if(/※\s*[23３２]/.test(lesson.subject))errors.push(`lessons ${lesson.id}: 脚注を確認してください`);
    refs(lesson.sources,`lessons ${lesson.id}`);
  }
  for(const day of data.calendar){
    if(day.date<data.term.start||day.date>data.term.end)errors.push(`calendar ${day.date}: 学期の範囲外です`);
    if(day.dayType==='HOLIDAY'&&(day.overrideDayOfWeek!=null||day.overrideDayType!=null))errors.push(`calendar ${day.date}: 休日に授業の振替は指定できません`);
    if(day.overrideDayType!=null&&day.overrideDayOfWeek==null)errors.push(`calendar ${day.date}: 振替先の曜日がありません`);
    refs(day.sources,`calendar ${day.date}`);
  }
  return errors;
}
export function parseSktjf(text){const data=JSON.parse(text);const errors=validateSktjf(data);if(errors.length)throw new Error(errors.join('\n'));return data;}
export function serializeSktjf(data){const errors=validateSktjf(data);if(errors.length)throw new Error(errors.join('\n'));return `${JSON.stringify(data,null,2)}\n`;}
