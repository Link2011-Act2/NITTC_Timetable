import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDistribution} from '../lib/export.js';
import {buildDistributionV3,inspectDistributionV3} from '../lib/export-v3.js';
import {putSelectionGroup} from '../web/table-model.js';
import {fixture} from './support/synthetic.js';

test('only reviewed explicit selections are exported and old formats never discard them',async()=>{
  const {project,options}=fixture(), cell=project.lessons[0];
  cell.entries.push({...cell.entries[0],id:'alternative',subject:'選択授業'});
  putSelectionGroup(project,{term:'S',classId:'1-1',day:1,period:1,lessonIds:['stable-id','alternative'],id:'group'});
  await assert.rejects(buildDistribution(project,options),/この形式では書き出せません/);
  const before=await inspectDistributionV3(project,options,[]);
  assert.ok(before.errors.some(error=>error.includes('確認してください')));
  project.selectionGroups[0].reviewed=true;
  const result=await buildDistributionV3(project,options,[]);
  assert.equal(result.schemaVersion,3);
  assert.deepEqual(result.selectionGroups[0].lessonIds,['stable-id','alternative']);
  assert.equal(result.lessons.length,2);
});
