import {inspectDistributionV2} from './export-v2.js';
import {validateSktjfV3} from './validator-v3.js';

/** Build selection groups only from explicit, reviewed project metadata. */
export async function inspectDistributionV3(project,options,weekDays){
  const groups=(project.selectionGroups||[]).filter(group=>group.term===options.term&&group.classId===options.classId);
  const working=structuredClone(project);delete working.selectionGroups;
  const days=weekDays??(project.weekCalendar||[]).filter(day=>day.scope===options.scope).map(day=>({...day,week:Number(day.week)}));
  const base=await inspectDistributionV2(working,options,days,groups);
  const document={...base.document,schemaVersion:3,selectionGroups:groups.map(group=>({
    id:group.id,dayOfWeek:group.day,period:group.period,lessonIds:[...group.lessonIds],sources:structuredClone(group.sources)
  }))};
  const errors=[...base.errors,...groups.filter(group=>!group.reviewed).map(group=>`selectionGroups ${group.id}: 選択授業を確認してください`),
    ...validateSktjfV3(document)];
  return {...base,document,errors:[...new Set(errors)]};
}
export async function buildDistributionV3(project,options,weekDays){
  const {document,errors}=await inspectDistributionV3(project,options,weekDays);
  if(errors.length)throw new Error(errors.join('\n'));
  return document;
}
