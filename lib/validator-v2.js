import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { validateSktjf } from './validator.js';

const schema=JSON.parse(readFileSync(new URL('../schema/sktjf-v2.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true});
addFormats(ajv);
const shape=ajv.compile(schema);

/** Inspect source-backed opportunity counts without assuming missing dates or school rules. */
export function inspectOpportunityOrdinals(data, series) {
  const policy=series.countingPolicy;
  if(!policy)return new Map();
  const calendar=new Map(data.calendar.map(day=>[day.date,day]));
  const excluded=new Set(policy.confirmedNonTeachingDates);
  const overrides=new Map(policy.officialPeriodOverrides.map(item=>[`${item.date}/${item.period}`,item.counts]));
  const result=new Map();let count=0,certain=true;
  const start=Date.parse(`${data.term.start}T00:00:00Z`),end=Date.parse(`${data.term.end}T00:00:00Z`);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>=370*86400000)return result;
  for(let stamp=start;stamp<=end;stamp+=86400000){
    const date=new Date(stamp).toISOString().slice(0,10),day=calendar.get(date);
    let status='unknown';
    if(!day){
      const hasPossibleLesson=series.periods.some(period=>overrides.has(`${date}/${period}`)&&overrides.get(`${date}/${period}`)!==false);
      const weekday=new Date(stamp).getUTCDay();
      status=!hasPossibleLesson&&(excluded.has(date)||weekday===0||weekday===6)?'excluded':'unknown';
    }
    else {
      const ordinaryDay=day.dayType==='HOLIDAY'?policy.holidayCounts:['A','B'].includes(day.dayType)?policy.regularDayCounts:null;
      const kind=day.event?.kind;
      const dayCounts=!day.event?ordinaryDay:Object.hasOwn(policy.eventCounts,kind)?policy.eventCounts[kind]:
        day.dayType==='HOLIDAY'?policy.holidayCounts:!kind||['MIDTERM','FINAL','EXAM_RETURN'].includes(kind)?null:ordinaryDay;
      const cycle=day.overrideDayType??day.dayType;
      const matches=series.cycle==='WEEKLY'?true:['A','B'].includes(cycle)?series.cycle===cycle:null;
      const weekday=day.overrideDayOfWeek??(new Date(stamp).getUTCDay()||7);
      const periods=series.periods.map(period=>overrides.has(`${date}/${period}`)?overrides.get(`${date}/${period}`):policy.ordinaryPeriodCounts);
      if(excluded.has(date)&&dayCounts!==false)status='unknown';
      else if(weekday!==series.dayOfWeek||dayCounts===false||matches===false)status='excluded';
      else if(dayCounts===null||matches===null)status='unknown';
      else if(periods.every(value=>value===true))status='included';
      else if(periods.every(value=>value===false))status='excluded';
    }
    if(status==='excluded')continue;
    if(status==='unknown'){certain=false;result.set(date,null);continue;}
    if(certain)count++;
    result.set(date,certain?count:null);
  }
  return result;
}

/** Potential overlaps in week-number space; dates or user choices may resolve them. */
export function findPotentialWeekOverlaps(data) {
  const result=[];
  for(let i=0;i<data.lessons.length;i++)for(let j=i+1;j<data.lessons.length;j++){
    const a=data.lessons[i],b=data.lessons[j];
    if(!a.activeWeekRange&&!b.activeWeekRange)continue;
    if(a.dayOfWeek!==b.dayOfWeek||a.period!==b.period)continue;
    if(a.cycle!=='WEEKLY'&&b.cycle!=='WEEKLY'&&a.cycle!==b.cycle)continue;
    if(a.conditions.all.some(x=>b.conditions.none.includes(x))||b.conditions.all.some(x=>a.conditions.none.includes(x)))continue;
    const start=Math.max(a.activeWeekRange?.start??1,b.activeWeekRange?.start??1);
    const end=Math.min(a.activeWeekRange?.end??999,b.activeWeekRange?.end??999);
    if(start<=end)result.push({first:a.id,second:b.id,dayOfWeek:a.dayOfWeek,period:a.period,start,end});
  }
  return result;
}

/** Validate v2 data and its source-backed opportunity evidence. */
export function validateSktjfV2(data) {
  if(!shape(data))return shape.errors.map(error=>`${error.instancePath||'/'} ${error.message}`);
  const legacy={...data,schemaVersion:1,lessons:data.lessons.map(({activeWeekRange,...lesson})=>lesson)};
  delete legacy.weekCalendar;
  delete legacy.weekSeries;
  const errors=validateSktjf(legacy);
  const sourceIds=new Set(data.sources.map(source=>source.id));
  const weeks=new Map();
  for(const entry of data.weekCalendar||[]){
    if(weeks.has(entry.date))errors.push(`weekCalendar ${entry.date}: 日付が重複しています`);
    weeks.set(entry.date,entry.week);
    if(entry.date<data.term.start||entry.date>data.term.end)errors.push(`weekCalendar ${entry.date}: 学期の範囲外です`);
    for(const source of entry.sources)if(!sourceIds.has(source.sourceId))errors.push(`weekCalendar ${entry.date}: 出典がありません`);
  }
  const timed=data.lessons.filter(lesson=>lesson.activeWeekRange);
  const seriesIds=new Set(),assigned=new Set(),lessonsById=new Map(data.lessons.map(lesson=>[lesson.id,lesson])),groupByLesson=new Map(),completeCounts=new Map();
  for(const series of data.weekSeries||[]){
    if(seriesIds.has(series.id))errors.push(`weekSeries ${series.id}: 識別子が重複しています`);
    seriesIds.add(series.id);
    for(const source of series.sources)if(!sourceIds.has(source.sourceId))errors.push(`weekSeries ${series.id}: 出典がありません`);
    if(series.countingPolicy){
      const policy=series.countingPolicy,keys=new Set();
      for(const source of policy.sources)if(!sourceIds.has(source.sourceId))errors.push(`weekSeries ${series.id}: 数え方の出典がありません`);
      for(const day of policy.confirmedNonTeachingDates)if(day<data.term.start||day>data.term.end)errors.push(`weekSeries ${series.id}: ${day} が学期の範囲外です`);
      for(const override of policy.officialPeriodOverrides){
        const key=`${override.date}/${override.period}`;
        if(keys.has(key))errors.push(`weekSeries ${series.id}: ${key} が重複しています`);keys.add(key);
        if(override.date<data.term.start||override.date>data.term.end||!series.periods.includes(override.period))errors.push(`weekSeries ${series.id}: ${key} の対象が正しくありません`);
      }
    }
    const matched=[];
    for(const id of series.lessonIds){
      if(assigned.has(id))errors.push(`weekSeries ${series.id}: 授業 ${id} が複数の授業機会に含まれます`);
      assigned.add(id);
      groupByLesson.set(id,series);
      const lesson=lessonsById.get(id);
      if(!lesson){errors.push(`weekSeries ${series.id}: 授業 ${id} がありません`);continue;}
      matched.push(lesson);
      if(lesson.dayOfWeek!==series.dayOfWeek||!series.periods.includes(lesson.period))errors.push(`weekSeries ${series.id}: 授業 ${id} の曜日または時限が一致しません`);
      if(series.cycle!=='WEEKLY'&&lesson.cycle!=='WEEKLY'&&series.cycle!==lesson.cycle)errors.push(`weekSeries ${series.id}: 授業 ${id} のA/Bが一致しません`);
    }
    if(series.periods.some(period=>!matched.some(lesson=>lesson.period===period)))errors.push(`weekSeries ${series.id}: 対応する授業がない時限があります`);
    if(series.countingPolicy){
      const counts=inspectOpportunityOrdinals(data,series);
      if([...counts.values()].some(number=>number===null)){
        if(matched.some(lesson=>lesson.activeWeekRange))errors.push(`weekSeries ${series.id}: 授業機会が未確認です`);
      }else{
        completeCounts.set(series.id,counts);
      }
    }
  }
  if(data.weekSeries?.length)for(const lesson of timed)if(!assigned.has(lesson.id))errors.push(`lessons ${lesson.id}: 授業機会がありません`);
  const countFor=(lesson,date)=>{const group=groupByLesson.get(lesson.id);return group?.countingPolicy?completeCounts.get(group.id)?.get(date):weeks.get(date);};
  const excluded=(lesson,date)=>{const counts=completeCounts.get(groupByLesson.get(lesson.id)?.id);return counts!==undefined&&!counts.has(date);};
  for(const lesson of timed){
    const range=lesson.activeWeekRange;
    if(range.start===null&&range.end===null)errors.push(`lessons ${lesson.id}: 週数範囲を指定してください`);
    if(range.start!==null&&range.end!==null&&range.start>range.end)errors.push(`lessons ${lesson.id}: 週数範囲が逆です`);
    for(const day of data.calendar){
      if(day.dayType==='HOLIDAY'&&!completeCounts.get(groupByLesson.get(lesson.id)?.id)?.has(day.date))continue;
      const dow=day.overrideDayOfWeek??(new Date(`${day.date}T00:00:00Z`).getUTCDay()||7);
      const cycle=day.overrideDayType??day.dayType;
      if(dow!==lesson.dayOfWeek)continue;
      if(lesson.cycle!=='WEEKLY'&&cycle===null){errors.push(`lessons ${lesson.id}: ${day.date} のA/Bが未確認です`);continue;}
      if(lesson.cycle!=='WEEKLY'&&lesson.cycle!==cycle)continue;
      if(countFor(lesson,day.date)===undefined&&!excluded(lesson,day.date))errors.push(`lessons ${lesson.id}: ${day.date} の授業週が未確認です`);
    }
  }
  const conditionsOverlap=(a,b)=>!a.all.some(x=>b.none.includes(x))&&!b.all.some(x=>a.none.includes(x));
  const active=(lesson,week)=>!lesson.activeWeekRange||
    ((lesson.activeWeekRange.start===null||week>=lesson.activeWeekRange.start)&&
     (lesson.activeWeekRange.end===null||week<=lesson.activeWeekRange.end));
  for(let i=0;i<data.lessons.length;i++)for(let j=i+1;j<data.lessons.length;j++){
    const a=data.lessons[i],b=data.lessons[j];
    if(!a.activeWeekRange&&!b.activeWeekRange)continue;
    if(a.dayOfWeek!==b.dayOfWeek||a.period!==b.period||!conditionsOverlap(a.conditions,b.conditions))continue;
    for(const day of data.calendar){
      if(day.dayType==='HOLIDAY'&&![a,b].some(lesson=>completeCounts.get(groupByLesson.get(lesson.id)?.id)?.has(day.date)))continue;
      const dow=day.overrideDayOfWeek??(new Date(`${day.date}T00:00:00Z`).getUTCDay()||7);
      const cycle=day.overrideDayType??day.dayType,weekA=countFor(a,day.date),weekB=countFor(b,day.date);
      if(dow!==a.dayOfWeek||(a.activeWeekRange&&weekA===undefined)||(b.activeWeekRange&&weekB===undefined))continue;
      if([a,b].every(lesson=>lesson.cycle==='WEEKLY'||lesson.cycle===cycle)&&active(a,weekA)&&active(b,weekB))
        errors.push(`lessons ${a.id}/${b.id}: ${day.date} の授業が重なっています`);
    }
  }
  return errors;
}
