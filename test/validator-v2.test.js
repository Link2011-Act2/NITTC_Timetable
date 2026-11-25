import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDistribution} from '../lib/export.js';
import {findPotentialWeekOverlaps,inspectOpportunityOrdinals,validateSktjfV2} from '../lib/validator-v2.js';
import {fixture} from './support/synthetic.js';

test('official opportunity counts share adjacent periods and remain uncertain after missing or conflicting dates',()=>{
  const start=new Date('2026-10-05T00:00:00Z');
  const calendar=Array.from({length:64},(_,i)=>({date:new Date(start.getTime()+i*86400000).toISOString().slice(0,10),dayType:'A'}));
  const data={term:{start:calendar[0].date,end:calendar.at(-1).date},calendar};
  const series={dayOfWeek:1,periods:[1,2],cycle:'WEEKLY',countingPolicy:{regularDayCounts:true,holidayCounts:false,
    eventCounts:{},ordinaryPeriodCounts:true,officialPeriodOverrides:[],confirmedNonTeachingDates:[]}};
  let counts=inspectOpportunityOrdinals(data,series);
  assert.equal(counts.get('2026-11-23'),8);assert.equal(counts.get('2026-11-30'),9);
  data.calendar=calendar.filter(day=>day.date!=='2026-10-06');
  counts=inspectOpportunityOrdinals(data,series);assert.equal(counts.get('2026-11-30'),null);
  series.countingPolicy.confirmedNonTeachingDates=['2026-10-06'];
  counts=inspectOpportunityOrdinals(data,series);assert.equal(counts.get('2026-11-30'),9);
  data.calendar=calendar;counts=inspectOpportunityOrdinals(data,series);assert.equal(counts.get('2026-11-30'),null);
  series.countingPolicy.confirmedNonTeachingDates=[];
  series.countingPolicy.officialPeriodOverrides=[{date:'2026-10-12',period:1,counts:false}];
  counts=inspectOpportunityOrdinals(data,series);assert.equal(counts.get('2026-11-30'),null);
});

test('unlisted weekends do not count but specified weekend substitutions do',()=>{
  const start=new Date('2026-10-05T00:00:00Z');
  const calendar=Array.from({length:8},(_,i)=>({date:new Date(start.getTime()+i*86400000).toISOString().slice(0,10),dayType:'A'}));
  const data={term:{start:calendar[0].date,end:calendar.at(-1).date},calendar:calendar.filter(day=>!['2026-10-10','2026-10-11'].includes(day.date))};
  const series={dayOfWeek:1,periods:[1,2],cycle:'WEEKLY',countingPolicy:{regularDayCounts:true,holidayCounts:false,
    eventCounts:{},ordinaryPeriodCounts:true,officialPeriodOverrides:[],confirmedNonTeachingDates:[]}};
  assert.equal(inspectOpportunityOrdinals(data,series).get('2026-10-12'),2);
  series.countingPolicy.officialPeriodOverrides=[{date:'2026-10-10',period:1,counts:true}];
  assert.equal(inspectOpportunityOrdinals(data,series).get('2026-10-12'),null);
  data.calendar.push({date:'2026-10-10',dayType:'A',overrideDayOfWeek:1});
  assert.equal(inspectOpportunityOrdinals(data,series).get('2026-10-12'),3);
});

test('ordinary events preserve scheduled classes while an unspecified exam remains uncertain',()=>{
  const data={term:{start:'2026-10-05',end:'2026-10-05'},calendar:[{date:'2026-10-05',dayType:'A',event:{name:'進路指導',kind:'EVENT'}}]};
  const series={dayOfWeek:1,periods:[1],cycle:'WEEKLY',countingPolicy:{regularDayCounts:true,holidayCounts:false,
    eventCounts:{},ordinaryPeriodCounts:true,officialPeriodOverrides:[],confirmedNonTeachingDates:[]}};
  assert.equal(inspectOpportunityOrdinals(data,series).get('2026-10-05'),1);
  data.calendar[0].event.kind='MIDTERM';
  assert.equal(inspectOpportunityOrdinals(data,series).get('2026-10-05'),null);
  series.countingPolicy.eventCounts.MIDTERM=false;
  assert.equal(inspectOpportunityOrdinals(data,series).has('2026-10-05'),false);
});

test('complete source policy validates timed changes without precomputed dates',async()=>{
  const {project,options}=fixture(),base=await buildDistribution(project,options),first=base.lessons[0];
  const start=new Date('2026-04-06T00:00:00Z');
  const calendar=Array.from({length:63},(_,i)=>({...base.calendar[0],date:new Date(start.getTime()+i*86400000).toISOString().slice(0,10)}));
  const before={...first,cycle:'WEEKLY',activeWeekRange:{start:null,end:8,notation:'8週まで'}};
  const after={...before,id:'after',subject:'卒研',activeWeekRange:{start:9,end:null,notation:'9週から'}};
  const policy={regularDayCounts:true,holidayCounts:false,eventCounts:{},ordinaryPeriodCounts:true,
    officialPeriodOverrides:[],confirmedNonTeachingDates:[],sources:[{sourceId:'src',page:1}]};
  const candidate={...base,schemaVersion:2,term:{...base.term,end:calendar.at(-1).date},calendar,lessons:[before,after],weekCalendar:[],
    weekSeries:[{id:'shared',dayOfWeek:1,periods:[1],lessonIds:[before.id,after.id],cycle:'WEEKLY',sources:[{sourceId:'src',page:1}],countingPolicy:policy}]};
  assert.deepEqual(validateSktjfV2(candidate),[]);
  const holiday=structuredClone(candidate);holiday.calendar[0].dayType='HOLIDAY';holiday.weekSeries[0].countingPolicy.holidayCounts=true;
  holiday.lessons[0].activeWeekRange.end=1;holiday.lessons[1].activeWeekRange={start:1,end:1,notation:'1週'};
  assert.ok(validateSktjfV2(holiday).some(error=>error.includes('授業が重なっています')));
  const separate=structuredClone(candidate);separate.weekCalendar=[{date:calendar[0].date,week:9,sources:[{sourceId:'src',page:1}]}];
  separate.lessons[0].activeWeekRange.end=1;separate.lessons[1].activeWeekRange={start:1,end:1,notation:'1週'};
  assert.ok(validateSktjfV2(separate).some(error=>error.includes('授業が重なっています')));
  after.activeWeekRange.start=8;
  assert.ok(validateSktjfV2(candidate).some(error=>error.includes('授業が重なっています')));
  after.activeWeekRange.start=9;candidate.calendar[7]={...candidate.calendar[7],dayType:null,event:{name:'行事',kind:'EVENT'}};
  assert.ok(validateSktjfV2(candidate).some(error=>error.includes('授業機会が未確認')));
});

test('v2 week ranges require explicit dated evidence and reject missing or contradictory ranges',async()=>{
  const {project,options}=fixture();
  const base=await buildDistribution(project,options);
  const candidate={...base,schemaVersion:2,lessons:base.lessons.map((lesson,i)=>i?lesson:{...lesson,activeWeekRange:{start:9,end:null,notation:'（9週〜）'}})};
  assert.ok(validateSktjfV2(candidate).some(error=>error.includes('授業週が未確認')));
  candidate.weekCalendar=[{date:'2026-04-06',week:9,sources:[{sourceId:'src',page:1}]}];
  assert.deepEqual(validateSktjfV2(candidate),[]);
  candidate.lessons[0].activeWeekRange.end=8;
  assert.ok(validateSktjfV2(candidate).some(error=>error.includes('逆')));
  candidate.lessons[0].activeWeekRange.end=null;
  candidate.weekCalendar[0].sources[0].sourceId='missing';
  assert.ok(validateSktjfV2(candidate).some(error=>error.includes('出典')));
});

test('an unrestricted lesson is not assumed to end when another lesson starts',async()=>{
  const {project,options}=fixture(),base=await buildDistribution(project,options),first=base.lessons[0];
  const replacement={...first,id:'additional',subject:'卒研',activeWeekRange:{start:9,end:null,notation:'（9週〜）'}};
  const candidate={...base,schemaVersion:2,lessons:[...base.lessons,replacement],
    weekCalendar:[{date:'2026-04-06',week:9,sources:[{sourceId:'src',page:1}]}]};
  assert.ok(validateSktjfV2(candidate).some(error=>error.includes('授業が重なっています')));
  candidate.lessons[0]={...first,activeWeekRange:{start:null,end:8,notation:'（〜8週）'}};
  assert.deepEqual(validateSktjfV2(candidate),[]);
  candidate.lessons[0]={...first,conditions:{all:[],none:['DD']}};
  replacement.conditions={all:['DD'],none:[]};
  assert.deepEqual(validateSktjfV2(candidate),[]);
});

test('weekly overlap is detected even if an event has no A or B designation',async()=>{
  const {project,options}=fixture(),base=await buildDistribution(project,options);
  const first={...base.lessons[0],cycle:'WEEKLY',activeWeekRange:{start:9,end:null,notation:'（9週〜）'}};
  const second={...first,id:'second',subject:'別授業'};
  const calendar=base.calendar.map(day=>day.date==='2026-04-06'?{...day,dayType:null,event:{name:'行事',kind:'EVENT'}}:day);
  const candidate={...base,schemaVersion:2,lessons:[first,second],calendar,
    weekCalendar:[{date:'2026-04-06',week:9,sources:[{sourceId:'src',page:1}]}]};
  assert.ok(validateSktjfV2(candidate).some(error=>error.includes('授業が重なっています')));
});

test('Sunday lessons also require week evidence',async()=>{
  const {project,options}=fixture(),base=await buildDistribution(project,options);
  const sunday={...base.lessons[0],id:'sunday',dayOfWeek:7,cycle:'WEEKLY',activeWeekRange:{start:9,end:null,notation:'（9週〜）'}};
  const candidate={...base,schemaVersion:2,term:{...base.term,end:'2026-04-12'},lessons:[...base.lessons,sunday],
    slotCoverage:[...base.slotCoverage,{...base.slotCoverage[0],dayOfWeek:7}],
    calendar:[...base.calendar,{...base.calendar[0],date:'2026-04-12'}]};
  assert.ok(validateSktjfV2(candidate).some(error=>error.includes('2026-04-12')&&error.includes('授業週が未確認')));
});

test('week ranges can be compared without a calendar while respecting A B and attributes',async()=>{
  const {project,options}=fixture(),base=await buildDistribution(project,options);
  const first={...base.lessons[0],cycle:'WEEKLY',conditions:{all:[],none:[]},
    activeWeekRange:{start:null,end:8,notation:'第8週まで'}};
  const second={...first,id:'second',activeWeekRange:{start:9,end:null,notation:'9週〜'}};
  const candidate={...base,schemaVersion:2,lessons:[first,second]};
  assert.deepEqual(findPotentialWeekOverlaps(candidate),[]);
  second.activeWeekRange.start=8;
  assert.deepEqual(findPotentialWeekOverlaps(candidate).map(({start,end})=>({start,end})),[{start:8,end:8}]);
  first.cycle='A';second.cycle='B';
  assert.deepEqual(findPotentialWeekOverlaps(candidate),[]);
  first.cycle='WEEKLY';second.cycle='WEEKLY';
  first.conditions={all:[],none:['DD']};second.conditions={all:['DD'],none:[]};
  assert.deepEqual(findPotentialWeekOverlaps(candidate),[]);
  second.conditions={all:[],none:[]};delete first.activeWeekRange;
  assert.equal(findPotentialWeekOverlaps(candidate).length,1);
});

test('explicit opportunity series preserves membership and rejects invented associations',async()=>{
  const {project,options}=fixture(),base=await buildDistribution(project,options),first=base.lessons[0];
  const candidate={...base,schemaVersion:2,lessons:[{...first,activeWeekRange:{start:9,end:null,notation:'（9週〜）'}}],
    weekCalendar:[{date:'2026-04-06',week:9,sources:[{sourceId:'src',page:1}]}],
    weekSeries:[{id:'shared',dayOfWeek:1,periods:[1],lessonIds:[first.id],cycle:'WEEKLY',sources:[{sourceId:'src',page:1}]}]};
  assert.deepEqual(validateSktjfV2(candidate),[]);
  candidate.weekSeries[0].countingPolicy={regularDayCounts:true,holidayCounts:false,eventCounts:{},ordinaryPeriodCounts:true,
    officialPeriodOverrides:[{date:'2026-04-06',period:1,counts:null}],confirmedNonTeachingDates:[],sources:[{sourceId:'src',page:1}]};
  assert.ok(validateSktjfV2(candidate).some(error=>error.includes('授業機会が未確認')));
  candidate.weekSeries[0].countingPolicy.officialPeriodOverrides.push({date:'2026-04-06',period:1,counts:true});
  assert.ok(validateSktjfV2(candidate).length>0);
  candidate.weekSeries[0].countingPolicy.officialPeriodOverrides.pop();
  candidate.weekSeries[0].countingPolicy.sources[0].sourceId='missing';
  assert.ok(validateSktjfV2(candidate).some(error=>error.includes('出典がありません')));
  delete candidate.weekSeries[0].countingPolicy;
  candidate.weekSeries[0].periods.push(2);
  assert.ok(validateSktjfV2(candidate).some(error=>error.includes('対応する授業がない時限')));
  candidate.weekSeries[0].periods=[1];candidate.weekSeries[0].lessonIds.push('missing');
  assert.ok(validateSktjfV2(candidate).some(error=>error.includes('授業 missing がありません')));
  candidate.weekSeries[0].lessonIds=[first.id];candidate.weekSeries[0].sources[0].sourceId='missing';
  assert.ok(validateSktjfV2(candidate).some(error=>error.includes('出典がありません')));
});
