import {createHash} from 'node:crypto';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {buildDistribution} from './export.js';
import {findPotentialWeekOverlaps,inspectOpportunityOrdinals,validateSktjfV2} from './validator-v2.js';

/** Build a local inspection candidate without treating unresolved weeks as approved. */
export async function inspectDistributionV2(project, options, weekDays = project.weekCalendar?.filter(day=>day.scope===options.scope).map(day=>({...day,week:Number(day.week)}))) {
  if(!Array.isArray(weekDays))throw new Error('授業週の日付を確認してください');
  const working=structuredClone(project), ranges=new Map();
  for(const cell of working.lessons.filter(c=>c.term===options.term&&c.classId===options.classId)){
    for(const entry of cell.entries){
      if(!entry.weekStart&&!entry.weekEnd&&!entry.weekSourceNotation)continue;
      if(!entry.weekSourceNotation||(!entry.weekStart&&!entry.weekEnd)||
        (entry.weekStart&&!/^[1-9][0-9]{0,2}$/.test(entry.weekStart))||
        (entry.weekEnd&&!/^[1-9][0-9]{0,2}$/.test(entry.weekEnd)))throw new Error('授業週の範囲と元の表記を確認してください');
      ranges.set(entry.id,{start:entry.weekStart?Number(entry.weekStart):null,end:entry.weekEnd?Number(entry.weekEnd):null,notation:entry.weekSourceNotation});
      delete entry.weekStart;delete entry.weekEnd;delete entry.weekSourceNotation;
    }
  }
  const result=await buildDistribution(working,options);
  result.schemaVersion=2;
  for(const lesson of result.lessons)if(ranges.has(lesson.id))lesson.activeWeekRange=ranges.get(lesson.id);
  const projectSeries=(project.weekSeries||[]).filter(item=>item.term===options.term&&item.classId===options.classId);
  const selectedSeries=options.weekSeries??projectSeries.map(({term,classId,reviewed,...item})=>item);
  if(!Array.isArray(selectedSeries))throw new Error('授業機会を確認してください');
  if(selectedSeries.length)result.weekSeries=structuredClone(selectedSeries);
  const sourceById=new Map(project.sources.map(source=>[source.id,source])),known=new Set(result.sources.map(source=>source.id)),counts=new Map();
  result.weekCalendar=[];
  for(const day of weekDays){
    if(day.reviewed!==true||!Number.isSafeInteger(day.week)||day.week<1||typeof day.date!=='string')throw new Error('授業週の日付は確認済みにしてください');
    const source=sourceById.get(day.sourceId);
    if(!source||!Number.isInteger(day.sourcePage)||day.sourcePage<1)throw new Error(`${day.date}: 出典がありません`);
    if(!counts.has(source.id)){
      const bytes=Buffer.from(source.data,'base64');
      if(createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw new Error(`${day.date}: 出典PDFを確認してください`);
      const doc=await pdfjs.getDocument({data:new Uint8Array(bytes)}).promise;
      counts.set(source.id,doc.numPages);
    }
    if(day.sourcePage>counts.get(source.id))throw new Error(`${day.date}: 出典ページを確認してください`);
    if(!known.has(source.id)){const {id,name,sha256,url}=source;result.sources.push({id,name,sha256,...(url?{url}:{})});known.add(id);}
    result.weekCalendar.push({date:day.date,week:day.week,sources:[{sourceId:source.id,page:day.sourcePage}]});
  }
  for(const series of result.weekSeries||[])for(const ref of [...(series.sources||[]),...(series.countingPolicy?.sources||[])]){
    const source=sourceById.get(ref.sourceId);
    if(!source||!Number.isInteger(ref.page)||ref.page<1)throw new Error(`${series.id}: 出典がありません`);
    if(!counts.has(source.id)){
      const bytes=Buffer.from(source.data,'base64');
      if(createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw new Error(`${series.id}: 出典PDFを確認してください`);
      const doc=await pdfjs.getDocument({data:new Uint8Array(bytes)}).promise;counts.set(source.id,doc.numPages);
    }
    if(ref.page>counts.get(source.id))throw new Error(`${series.id}: 出典ページを確認してください`);
    if(!known.has(source.id)){const {id,name,sha256,url}=source;result.sources.push({id,name,sha256,...(url?{url}:{})});known.add(id);}
  }
  const unreviewed=options.weekSeries===undefined?projectSeries.filter(item=>item.reviewed!==true).map(item=>`weekSeries ${item.id}: 授業機会を確認してください`):
    options.weekSeriesConfirmed===true?[]:selectedSeries.map(item=>`weekSeries ${item.id}: 授業機会を確認してください`);
  const errors=[...validateSktjfV2(result),...unreviewed];
  const opportunityOrdinals={};
  if(!errors.some(error=>error.startsWith('/')))for(const series of result.weekSeries||[]){
    if(series.countingPolicy)opportunityOrdinals[series.id]=Object.fromEntries(inspectOpportunityOrdinals(result,series));
  }
  return {document:result,errors,potentialOverlaps:findPotentialWeekOverlaps(result),opportunityOrdinals};
}

/** Export requires validation; inspection candidates with unresolved weeks cannot be released. */
export async function buildDistributionV2(project, options, weekDays) {
  const {document,errors}=await inspectDistributionV2(project,options,weekDays);
  if(errors.length)throw new Error(errors.join('\n'));
  return document;
}
