import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {readFileSync} from 'node:fs';
import {validateSktjfV2} from './validator-v2.js';

const ajv=new Ajv2020({allErrors:true,strict:true,allowUnionTypes:true});
addFormats(ajv);
const shape=ajv.compile(JSON.parse(readFileSync(new URL('../schema/sktjf-v3.schema.json',import.meta.url),'utf8')));

/** Only explicit source-backed groups describe elective alternatives. */
export function validateSktjfV3(data){
  if(!shape(data))return shape.errors.map(error=>`${error.instancePath||'/'} ${error.message}`);
  const {selectionGroups=[],...common}=data;
  const errors=validateSktjfV2({...common,schemaVersion:2},{selectionGroups});
  const lessons=new Map(data.lessons.map(lesson=>[lesson.id,lesson]));
  const sources=new Set(data.sources.map(source=>source.id));
  const ids=new Set(),assigned=new Set();
  for(const group of selectionGroups){
    if(ids.has(group.id))errors.push(`selectionGroups ${group.id}: 識別子が重複しています`);
    ids.add(group.id);
    for(const source of group.sources)if(!sources.has(source.sourceId))errors.push(`selectionGroups ${group.id}: 出典がありません`);
    const members=group.lessonIds.map(id=>{
      if(assigned.has(id))errors.push(`selectionGroups ${group.id}: 授業 ${id} が複数のグループに含まれます`);
      assigned.add(id);
      const lesson=lessons.get(id);
      if(!lesson)errors.push(`selectionGroups ${group.id}: 授業 ${id} がありません`);
      else if(lesson.dayOfWeek!==group.dayOfWeek||lesson.period!==group.period)errors.push(`selectionGroups ${group.id}: 曜日または時限が一致しません`);
      return lesson;
    }).filter(Boolean);
    if(new Set(members.map(lesson=>lesson.cycle)).size>1)errors.push(`selectionGroups ${group.id}: A/Bが一致しません`);
  }
  return errors;
}
