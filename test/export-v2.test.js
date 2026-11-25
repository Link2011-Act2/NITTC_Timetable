import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDistributionV2,inspectDistributionV2} from '../lib/export-v2.js';
import {validateSktjfV2} from '../lib/validator-v2.js';
import {putWeekSeries,validProject} from '../web/table-model.js';
import {fixture} from './support/synthetic.js';
import {extractPage} from '../web/extract.js';

test('extracted week note survives project save and inspection without assuming a date',async()=>{
  const item=(str,x,y)=>({str,transform:[1,0,0,1,x,y]});
  const headers=Array.from({length:20},(_,i)=>item('校時',167+i*48,782));
  const anchors=[773,747,721,695].flatMap((y,i)=>[item(String(i+1),119,y),item('組',123,y)]);
  const extracted=extractPage([...headers,...anchors,item('卒研（9週〜）',167,773)],1190,842,2026,'S',1);
  const cell=extracted.lessons.find(value=>value.classId==='1-1'&&value.day===1&&value.period===1);
  assert.equal(cell.raw,'卒研（9週〜）');assert.equal(cell.reviewed,false);assert.equal(cell.rawUnparsed,true);
  const {project,options}=fixture();
  project.lessons[0]={...cell,sourceId:'src',sourcePage:1,reviewed:true,rawUnparsed:false};
  const saved=JSON.parse(JSON.stringify(project));assert.equal(validProject(saved),true);
  const result=await inspectDistributionV2(saved,options,[]);
  assert.equal(saved.lessons[0].raw,'卒研（9週〜）');
  assert.equal(result.document.lessons[0].subject,'卒研');
  assert.deepEqual(result.document.lessons[0].activeWeekRange,{start:9,end:null,notation:'（9週〜）'});
  assert.ok(result.errors.some(error=>error.includes('授業週が未確認')));
  await assert.rejects(buildDistributionV2(saved,options,[]),/授業週が未確認/);
});

test('candidate export preserves the reviewed source project and requires explicit week evidence',async()=>{
  const {project,options}=fixture();
  Object.assign(project.lessons[0].entries[0],{subject:'卒研',weekStart:'9',weekEnd:'',weekSourceNotation:'（9週〜）'});
  const original=structuredClone(project),day={date:'2026-04-06',week:9,sourceId:'src',sourcePage:1,reviewed:true};
  await assert.rejects(buildDistributionV2(project,options,[]),/授業週が未確認/);
  await assert.rejects(buildDistributionV2(project,options,[{...day,reviewed:false}]),/確認済み/);
  await assert.rejects(buildDistributionV2(project,options,[{...day,sourcePage:2}]),/出典ページ/);
  const result=await buildDistributionV2(project,options,[day]);
  assert.equal(result.schemaVersion,2);
  assert.deepEqual(result.lessons[0].activeWeekRange,{start:9,end:null,notation:'（9週〜）'});
  assert.deepEqual(result.weekCalendar,[{date:day.date,week:9,sources:[{sourceId:'src',page:1}]}]);
  assert.deepEqual(project,original);
  project.weekCalendar=[{scope:options.scope,date:day.date,week:'9',sourceId:'src',sourcePage:1,reviewed:true}];
  assert.deepEqual((await buildDistributionV2(project,options)).weekCalendar,result.weekCalendar);
  project.weekCalendar[0].reviewed=false;
  await assert.rejects(buildDistributionV2(project,options),/確認済み/);
});

test('unresolved week numbers can be inspected without becoming an export',async()=>{
  const {project,options}=fixture();
  Object.assign(project.lessons[0].entries[0],{subject:'卒研',weekStart:'9',weekEnd:'',weekSourceNotation:'（9週〜）'});
  const original=structuredClone(project);
  const candidate=await inspectDistributionV2(project,options,[]);
  assert.deepEqual(candidate.document.lessons[0].activeWeekRange,{start:9,end:null,notation:'（9週〜）'});
  assert.deepEqual(candidate.document.weekCalendar,[]);
  assert.ok(candidate.errors.some(error=>error.includes('授業週が未確認')));
  assert.deepEqual(validateSktjfV2(candidate.document),candidate.errors);
  await assert.rejects(buildDistributionV2(project,options,[]),/授業週が未確認/);
  assert.deepEqual(project,original);
});

test('inspection carries explicitly supplied opportunity membership without inventing dates',async()=>{
  const {project,options}=fixture(),entry=project.lessons[0].entries[0];
  Object.assign(entry,{subject:'卒研',weekStart:'9',weekEnd:'',weekSourceNotation:'（9週〜）'});
  const series=[{id:'shared',dayOfWeek:1,periods:[1],lessonIds:[entry.id],cycle:'WEEKLY',sources:[{sourceId:'src',page:1}]}];
  const candidate=await inspectDistributionV2(project,{...options,weekSeries:series},[]);
  assert.deepEqual(candidate.document.weekSeries,series);
  assert.ok(candidate.errors.some(error=>error.includes('授業週が未確認')));
  await assert.rejects(buildDistributionV2(project,{...options,weekSeries:series},[]),/授業週が未確認/);
});

test('saved opportunity grouping is kept in inspection and unreviewed grouping blocks export',async()=>{
  const {project,options}=fixture(),entry=project.lessons[0].entries[0];
  Object.assign(entry,{subject:'卒研',weekStart:'9',weekEnd:'',weekSourceNotation:'（9週〜）'});
  project.weekSeries=[{term:'S',classId:'1-1',id:'shared',dayOfWeek:1,periods:[1],lessonIds:[entry.id],cycle:'WEEKLY',
    sources:[{sourceId:'src',page:1}],reviewed:false}];
  const restored=JSON.parse(JSON.stringify(project));
  const day={date:'2026-04-06',week:9,sourceId:'src',sourcePage:1,reviewed:true};
  const candidate=await inspectDistributionV2(restored,options,[day]);
  assert.equal(candidate.document.weekSeries[0].lessonIds[0],entry.id);
  assert.ok(candidate.errors.some(error=>error.includes('授業機会を確認')));
  await assert.rejects(buildDistributionV2(restored,options,[day]),/授業機会を確認/);
  restored.weekSeries[0].reviewed=true;
  assert.deepEqual((await inspectDistributionV2(restored,options,[day])).errors,[]);
  assert.equal(project.weekSeries[0].reviewed,false);
});

test('created opportunity survives save and reopen with its source and separate review state',async()=>{
  const {project,options}=fixture(),entry=project.lessons[0].entries[0],oldReview=project.lessons[0].reviewed;
  Object.assign(entry,{subject:'卒研',weekStart:'9',weekEnd:'',weekSourceNotation:'（9週〜）'});
  const group=putWeekSeries(project,{term:'S',classId:'1-1',dayOfWeek:1,lessonIds:[entry.id],cycle:'WEEKLY',id:'shared'});
  group.reviewed=true;
  const saved=JSON.stringify(project),reopened=JSON.parse(saved);
  assert.equal(validProject(reopened),true);
  assert.equal(reopened.lessons[0].reviewed,oldReview);
  assert.deepEqual(reopened.weekSeries[0].sources,[{sourceId:'src',page:1}]);
  assert.equal(reopened.weekSeries[0].reviewed,true);
  const inspection=await inspectDistributionV2(reopened,options,[]);
  assert.equal(inspection.document.weekSeries[0].id,'shared');
  assert.ok(inspection.errors.some(error=>error.includes('授業週が未確認')));
  assert.equal(inspection.errors.some(error=>error.includes('授業機会を確認')),false);
  assert.equal(JSON.stringify(project),saved);
});

test('source-counted export preserves confirmed policy and rejects unresolved periods',async()=>{
  const {project,options}=fixture(),entry=project.lessons[0].entries[0];
  Object.assign(entry,{subject:'卒研',weekStart:'1',weekEnd:'',weekSourceNotation:'（1週〜）'});
  project.weekSeries=[{term:'S',classId:'1-1',id:'shared',dayOfWeek:1,periods:[1],lessonIds:[entry.id],cycle:'WEEKLY',reviewed:true,
    sources:[{sourceId:'src',page:1}],countingPolicy:{regularDayCounts:true,holidayCounts:false,eventCounts:{},ordinaryPeriodCounts:true,
      officialPeriodOverrides:[],confirmedNonTeachingDates:[],sources:[{sourceId:'src',page:1}]}}];
  const day={date:'2026-04-06',week:1,sourceId:'src',sourcePage:1,reviewed:true};
  assert.deepEqual((await inspectDistributionV2(project,options,[day])).errors,[]);
  const exported=await buildDistributionV2(project,options,[day]);
  assert.deepEqual(exported.weekSeries[0].countingPolicy,project.weekSeries[0].countingPolicy);
  project.weekSeries[0].countingPolicy.officialPeriodOverrides=[{date:'2026-04-06',period:1,counts:null}];
  await assert.rejects(buildDistributionV2(project,options,[day]),/授業機会が未確認/);
});
