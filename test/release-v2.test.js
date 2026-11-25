import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildDistributionV2} from '../lib/export-v2.js';
import {buildDistribution} from '../lib/export.js';
import {assembleReleaseV2,validateReleaseV2} from '../lib/release-v2.js';
import {fixture} from './support/synthetic.js';

test('mixed v1 and v2 assets validate against their own bytes and versions',async()=>{
  const {project,options}=fixture(),one=await buildDistribution(project,options);
  Object.assign(project.lessons[0].entries[0],{subject:'卒研',weekStart:'9',weekEnd:'',weekSourceNotation:'（9週〜）'});
  options.classId='1-2';for(const cell of project.lessons)cell.classId='1-2';
  const two=await buildDistributionV2(project,options,[{date:'2026-04-06',week:9,sourceId:'src',sourcePage:1,reviewed:true}]);
  const files=new Map([[one.classId+'.sktjf.json',Buffer.from(JSON.stringify(one))],[two.classId+'.sktjf.json',Buffer.from(JSON.stringify(two))]]);
  const assets=[one,two].map(doc=>{const name=doc.classId+'.sktjf.json';return {classId:doc.classId,name,url:`https://github.com/example/SKTJF/releases/download/2026.S.0/${name}`,sha256:createHash('sha256').update(files.get(name)).digest('hex'),dataFormatVersion:doc.schemaVersion};});
  const manifest={format:'SKTJF-MANIFEST',manifestVersion:1,schoolId:'nittc',academicYear:2026,term:'S',revision:'2026.S.0',publishedAt:'2026-04-01T00:00:00Z',dataFormatVersion:2,classIds:['1-1','1-2'],assets};
  assert.deepEqual(validateReleaseV2(manifest,files,['1-1','1-2'],true),[]);
  const corrupt=new Map(files);corrupt.set('1-2.sktjf.json',Buffer.concat([files.get('1-2.sktjf.json'),Buffer.from(' ')]));
  assert.ok(validateReleaseV2(manifest,corrupt).some(error=>error.includes('SHA-256')));
  assets[1].dataFormatVersion=1;
  assert.ok(validateReleaseV2(manifest,files).some(error=>error.includes('形式バージョン')));
});

test('local mixed candidate keeps approved first-year content and requires confirmed weeks',async()=>{
  const {project,options}=fixture(),old=await buildDistribution(project,options),bytes=Buffer.from(JSON.stringify(old));
  const checksum=createHash('sha256').update(bytes).digest('hex');
  const second=structuredClone(project);for(const cell of second.lessons)cell.classId='2M';
  Object.assign(second.lessons[0].entries[0],{subject:'卒研',weekStart:'9',weekEnd:'',weekSourceNotation:'（9週〜）'});
  const revision='2026.S.1.Beta',config={academicYear:2026,term:'S',revision,publishedAt:null,
    releaseBaseUrl:`https://github.com/example/SKTJF/releases/download/${revision}/`,expectedClasses:['1-1','2M'],
    entries:[{approvedV1:{bytes,sha256:checksum}},{project:second,options:{...options,classId:'2M',revision},weekDays:[]}]};
  await assert.rejects(assembleReleaseV2(config),/授業週が未確認/);
  config.entries[1].weekDays=[{date:'2026-04-06',week:9,sourceId:'src',sourcePage:1,reviewed:true}];
  const result=await assembleReleaseV2(config),first=JSON.parse(result.files.get('1-1.sktjf.json'));
  assert.deepEqual({...first,revision:old.revision},old);
  assert.deepEqual(result.manifest.assets.map(asset=>asset.dataFormatVersion),[1,2]);
  assert.deepEqual(validateReleaseV2(result.manifest,result.files,config.expectedClasses),[]);
  config.entries[0].approvedV1.sha256='0'.repeat(64);
  await assert.rejects(assembleReleaseV2(config),/SHA-256/);
});

test('mixed release validates a complete source-counted opportunity series',async()=>{
  const {project,options}=fixture(),entry=project.lessons[0].entries[0];
  Object.assign(entry,{subject:'卒研',weekStart:'1',weekEnd:'',weekSourceNotation:'（1週〜）'});
  project.weekSeries=[{term:'S',classId:'1-1',id:'shared',dayOfWeek:1,periods:[1],lessonIds:[entry.id],cycle:'WEEKLY',reviewed:true,
    sources:[{sourceId:'src',page:1}],countingPolicy:{regularDayCounts:true,holidayCounts:false,eventCounts:{},ordinaryPeriodCounts:true,
      officialPeriodOverrides:[],confirmedNonTeachingDates:[],sources:[{sourceId:'src',page:1}]}}];
  const revision='2026.S.0',config={academicYear:2026,term:'S',revision,publishedAt:null,
    releaseBaseUrl:`https://github.com/example/SKTJF/releases/download/${revision}/`,expectedClasses:['1-1'],
    entries:[{project,options,weekDays:[]}]};
  const result=await assembleReleaseV2(config);
  assert.deepEqual(validateReleaseV2(result.manifest,result.files,config.expectedClasses),[]);
  assert.equal(JSON.parse(result.files.get('1-1.sktjf.json')).weekSeries[0].countingPolicy.regularDayCounts,true);
});

test('approved first-year subjects are normalized without changing source or other content',async()=>{
  const {project,options}=fixture(),old=await buildDistribution(project,options);
  old.lessons[0].subject='保健・体育Ⅰ';
  const bytes=Buffer.from(JSON.stringify(old)),sha256=createHash('sha256').update(bytes).digest('hex');
  const revision='2026.S.1.Beta',config={academicYear:2026,term:'S',revision,publishedAt:null,
    releaseBaseUrl:`https://github.com/example/SKTJF/releases/download/${revision}/`,expectedClasses:['1-1'],
    entries:[{approvedV1:{bytes,sha256}}]};
  const candidate=await assembleReleaseV2(config),result=JSON.parse(candidate.files.get('1-1.sktjf.json'));
  assert.equal(result.lessons[0].subject,'保体I');
  result.lessons[0].subject=old.lessons[0].subject;result.revision=old.revision;
  assert.deepEqual(result,old);
});
