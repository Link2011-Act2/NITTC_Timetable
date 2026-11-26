import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildDistribution} from '../lib/export.js';
import {assembleReleaseV3,validateReleaseV3} from '../lib/release-v3.js';
import {putSelectionGroup} from '../web/table-model.js';
import {fixture} from './support/synthetic.js';

test('mixed legacy and explicit selection assets validate without losing group data',async()=>{
  const {project,options}=fixture(),old=await buildDistribution(project,options),bytes=Buffer.from(JSON.stringify(old));
  const second=structuredClone(project);for(const cell of second.lessons)cell.classId='2M';
  second.lessons[0].entries.push({...second.lessons[0].entries[0],id:'alternative',subject:'選択授業'});
  putSelectionGroup(second,{term:'S',classId:'2M',day:1,period:1,id:'group',lessonIds:['stable-id','alternative']}).reviewed=true;
  const revision='2026.S.1.Beta',config={academicYear:2026,term:'S',revision,publishedAt:null,
    releaseBaseUrl:`https://github.com/example/SKTJF/releases/download/${revision}/`,expectedClasses:['1-1','2M'],
    entries:[{approvedV1:{bytes,sha256:createHash('sha256').update(bytes).digest('hex')}},
      {project:second,options:{...options,classId:'2M',revision},weekDays:[]}]};
  const result=await assembleReleaseV3(config);
  assert.deepEqual(result.manifest.assets.map(asset=>asset.dataFormatVersion),[1,3]);
  assert.deepEqual(validateReleaseV3(result.manifest,result.files,config.expectedClasses),[]);
  assert.deepEqual(JSON.parse(result.files.get('2M.sktjf.json')).selectionGroups[0].lessonIds,['stable-id','alternative']);
  const corrupted=new Map(result.files);corrupted.set('2M.sktjf.json',Buffer.concat([corrupted.get('2M.sktjf.json'),Buffer.from(' ')]));
  assert.ok(validateReleaseV3(result.manifest,corrupted).some(error=>error.includes('SHA-256')));
});
