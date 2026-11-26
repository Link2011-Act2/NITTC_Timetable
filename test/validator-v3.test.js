import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDistribution} from '../lib/export.js';
import {validateSktjfV3} from '../lib/validator-v3.js';
import {fixture} from './support/synthetic.js';

async function candidate(){
  const {project,options}=fixture(), base=await buildDistribution(project,options), first=base.lessons[0];
  return {...base,schemaVersion:3,weekCalendar:[],lessons:[...base.lessons,{...first,id:'alternative',subject:'選択授業'}],
    selectionGroups:[{id:'choice-1',dayOfWeek:first.dayOfWeek,period:first.period,
      lessonIds:[first.id,'alternative'],sources:first.sources}]};
}
test('explicit source-backed alternatives validate independently of ordinary A/B lessons',async()=>{
  const doc=await candidate();assert.deepEqual(validateSktjfV3(doc),[]);
  const different=structuredClone(doc);different.lessons.at(-1).cycle='B';
  assert.ok(validateSktjfV3(different).some(error=>error.includes('A/B')));
  const missing=structuredClone(doc);missing.selectionGroups[0].lessonIds[1]='missing';
  assert.ok(validateSktjfV3(missing).some(error=>error.includes('ありません')));
  const duplicate=structuredClone(doc);duplicate.selectionGroups.push({...duplicate.selectionGroups[0],id:'choice-2'});
  assert.ok(validateSktjfV3(duplicate).some(error=>error.includes('複数')));
});

test('explicit group permits overlapping week ranges without weakening v2 validation',async()=>{
  const doc=await candidate();
  for(const lesson of doc.lessons)lesson.activeWeekRange={start:1,end:null,notation:'1週〜'};
  doc.weekCalendar=[{date:'2026-04-06',week:1,sources:doc.sources.map(source=>({sourceId:source.id,page:1}))}];
  assert.deepEqual(validateSktjfV3(doc),[]);
  const bad=structuredClone(doc);bad.selectionGroups[0].lessonIds[1]='unknown';
  assert.ok(validateSktjfV3(bad).length>0);
});
