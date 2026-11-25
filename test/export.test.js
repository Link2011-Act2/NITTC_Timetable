import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDistribution, scopeApplies } from '../lib/export.js';
import { emptyDay, emptyLesson } from '../web/table-model.js';
import { validateSktjf } from '../lib/validator.js';
import { fixture } from './support/synthetic.js';
test('exports Beta revisions and keeps advanced classes outside the current distribution',async()=>{
  const {project,options}=fixture();
  const beta={...options,revision:'2026.S.2.Beta'};
  assert.deepEqual(validateSktjf(await buildDistribution(project,beta)),[]);
  await assert.rejects(buildDistribution(project,{...beta,revision:'2026.F.2.Beta'}),/リビジョン/);
  await assert.rejects(buildDistribution(project,{...beta,revision:'2026.S.02.Beta'}),/リビジョン/);
  await assert.rejects(buildDistribution(project,{...beta,classId:'AC-1M',scope:'AC-1M'}),/本科/);
});
test('exports only reviewed complete data and preserves excluded slots and stable ids',async()=>{const {project,options}=fixture();const result=await buildDistribution(project,options);assert.deepEqual(validateSktjf(result),[]);assert.equal(result.lessons[0].id,'stable-id');assert.deepEqual(result.lessons[0].conditions.all,['DD']);assert.equal(result.slotCoverage.find(x=>x.dayOfWeek===2).state,'EXCLUDED');assert.equal(result.calendar.length,5);assert.equal('data' in result.sources[0],false);});
test('preserves the official source URL in the exported provenance',async()=>{const {project,options}=fixture();project.sources[0].url='https://example.edu/calendar.pdf';const data=await buildDistribution(project,options);assert.equal(data.sources[0].url,project.sources[0].url);project.sources[0].url='http://example.edu/calendar.pdf';await assert.rejects(buildDistribution(project,options));});
test('missing or unreviewed records, missing provenance and tampered PDF block export',async()=>{for(const mutate of [p=>p.lessons[0].reviewed=false,p=>p.lessons.pop(),p=>p.calendar.pop(),p=>p.calendar[0].sourcePage=2,p=>p.sources[0].sha256='a'.repeat(64)]){const {project,options}=fixture();mutate(project);await assert.rejects(buildDistribution(project,options));}});
test('wrong scope, ambiguous values and unresolved footnotes block export',async()=>{let f=fixture();await assert.rejects(buildDistribution(f.project,{...f.options,scope:'4ME'}));f=fixture();f.project.lessons[0].entries[0].subject='※3';await assert.rejects(buildDistribution(f.project,f.options));f=fixture();f.project.calendar[0].dayType='不明';await assert.rejects(buildDistribution(f.project,f.options));});
test('coverage confirmation and unresolved warnings are required',async()=>{const f=fixture();await assert.rejects(buildDistribution(f.project,{...f.options,coverageConfirmed:false}),/資料/);f.project.warnings.push({sourceId:'src',message:'ページを確認'});await assert.rejects(buildDistribution(f.project,f.options),/確認事項/);});
test('only explicitly unrelated warnings may be deferred for a class and term',async()=>{
  const {project,options}=fixture(),warning={sourceId:'src',message:'要確認'};
  for(const scope of [{term:'F'},{classIds:['1-2']},{excludedClassIds:['1-1']},{scope:'4ME'}]){
    project.warnings=[{...warning,...scope}];await buildDistribution(project,options);
  }
  for(const scope of [{},{term:'S'},{classIds:['1-1']},{excludedClassIds:['1-2']},{scope:'１・２・３年生'}]){
    project.warnings=[{...warning,...scope}];await assert.rejects(buildDistribution(project,options),/確認事項/);
  }
  for(const scope of [{term:'X'},{classIds:[]},{excludedClassIds:['bad']},{scope:'不明'}]){
    project.warnings=[{...warning,...scope}];await assert.rejects(buildDistribution(project,options),/作業ファイル/);
  }
});
test('export refuses to silently omit an entered period',async()=>{const f=fixture();f.project.lessons.push({...structuredClone(f.project.lessons[0]),period:f.options.periods.length+1});await assert.rejects(buildDistribution(f.project,f.options),/書き出し範囲/);});
test('unparsed source text cannot be published even if a cell is marked reviewed',async()=>{
  const f=fixture();f.project.lessons[0].rawUnparsed=true;
  await assert.rejects(buildDistribution(f.project,f.options),/科目・教員・教室/);
});
test('week restrictions cannot be published as ordinary unrestricted subjects',async()=>{
  for(const subject of ['卒研（9週〜）','工学実験・実習III (～10週)','数学II (5～10週)']){
    const {project,options}=fixture();project.lessons[0].entries[0].subject=subject;
    await assert.rejects(buildDistribution(project,options),/授業週/);
  }
  const {project,options}=fixture();
  Object.assign(project.lessons[0].entries[0],{subject:'卒研',weekStart:'9',weekEnd:'',weekSourceNotation:'（9週〜）'});
  await assert.rejects(buildDistribution(project,options),/実施週の配信/);
});
test('exports exclusions and explicit remote format while preserving old projects',async()=>{
  const f=fixture(),entry=f.project.lessons[0].entries[0];
  entry.excludedAttributes='INTERNATIONAL';entry.remote='yes';
  let result=await buildDistribution(JSON.parse(JSON.stringify(f.project)),f.options);
  assert.deepEqual(result.lessons[0].conditions,{all:['DD'],none:['INTERNATIONAL']});assert.equal(result.lessons[0].remote,true);
  entry.remote='no';result=await buildDistribution(f.project,f.options);assert.equal(result.lessons[0].remote,false);
  delete entry.remote;delete entry.excludedAttributes;result=await buildDistribution(f.project,f.options);assert.equal('remote' in result.lessons[0],false);assert.deepEqual(result.lessons[0].conditions.none,[]);
  entry.excludedAttributes='DD';await assert.rejects(buildDistribution(f.project,f.options),/矛盾/);
  entry.excludedAttributes='';entry.remote='unknown';await assert.rejects(buildDistribution(f.project,f.options),/授業の内容/);
});
test('older entries with omitted optional fields export without crashing',async()=>{
  const f=fixture(),entry=f.project.lessons[0].entries[0];
  delete entry.teacher;delete entry.room;delete entry.cycle;delete entry.attributes;
  const data=await buildDistribution(f.project,f.options);
  assert.deepEqual(data.lessons[0].teachers,[]);assert.deepEqual(data.lessons[0].rooms,[]);
  assert.equal(data.lessons[0].cycle,'WEEKLY');assert.deepEqual(data.lessons[0].conditions.all,[]);
  delete entry.subject;
  await assert.rejects(buildDistribution(f.project,f.options),/授業の内容/);
});
test('calendar grouping maps only intended classes',()=>{assert.equal(scopeApplies('１・２・３年生','3I'),true);assert.equal(scopeApplies('4ME','4I'),false);assert.equal(scopeApplies('4ME','4E'),true);assert.equal(scopeApplies('4・5年生','5B'),true);});
test('standalone events require an explicit day type while exam labels retain their existing behavior',async()=>{
  const {project,options}=fixture();
  const day=project.calendar[0];
  Object.assign(day,{dayType:'',label:'校内行事',eventKind:'EVENT'});
  await assert.rejects(buildDistribution(project,options),/A\/Bまたは休日/);
  day.dayType='HOLIDAY';
  assert.deepEqual((await buildDistribution(project,options)).calendar[0].event,{name:'校内行事',kind:'EVENT'});
  Object.assign(day,{dayType:'',label:'中間試験',eventKind:'MIDTERM'});
  const exam=(await buildDistribution(project,options)).calendar[0];
  assert.equal(exam.dayType,null);
  assert.equal(exam.event.kind,'MIDTERM');
  day.dayType='B';day.eventSourceId='src';day.eventSourcePage=1;
  const examWithCycle=(await buildDistribution(project,options)).calendar[0];
  assert.equal(examWithCycle.dayType,'B');assert.equal(examWithCycle.event.kind,'MIDTERM');
  assert.deepEqual(examWithCycle.sources,[{sourceId:'src',page:1}]);
  project.sources.push({...project.sources[0],id:'exam-source'});day.eventSourceId='exam-source';
  const separateSource=(await buildDistribution(project,options)).calendar[0];
  assert.deepEqual(separateSource.sources,[{sourceId:'src',page:1},{sourceId:'exam-source',page:1}]);
  day.eventSourcePage=2;
  await assert.rejects(buildDistribution(project,options),/行事|ページ/);
});
test('entered weekend dates are reviewed and exported without requiring empty weekends',async()=>{
  const {project,options}=fixture();options.end='2026-04-12';
  assert.equal((await buildDistribution(project,options)).calendar.length,5);
  const saturday={...emptyDay('2026-04-11'),scope:options.scope,dayType:'A',lessonDay:'1',lessonType:'B',label:'学校行事',eventKind:'EVENT',sourceId:'src',sourcePage:1};
  project.calendar.push(saturday);
  await assert.rejects(buildDistribution(project,options),/2026-04-11: 日付が未確認/);
  saturday.reviewed=true;
  const output=await buildDistribution(project,options),day=output.calendar.find(item=>item.date===saturday.date);
  assert.equal(day.dayType,'A');assert.equal(day.overrideDayOfWeek,1);assert.equal(day.overrideDayType,'B');
  assert.equal('event' in day,false);assert.deepEqual(validateSktjf(output),[]);
  project.calendar.push({...emptyDay('2026-04-12'),scope:options.scope,dayType:'HOLIDAY',label:'学校行事',eventKind:'EVENT',reviewed:true,sourceId:'src',sourcePage:1});
  const holiday=(await buildDistribution(project,options)).calendar.find(item=>item.date==='2026-04-12');
  assert.equal(holiday.dayType,'HOLIDAY');assert.deepEqual(holiday.event,{name:'学校行事',kind:'EVENT'});
});
test('footnote 2 becomes an extension and footnote 3 remains explicitly excluded',async()=>{
  const f=fixture();f.project.lessons[0].entries[0].subject='※2';f.project.lessons[0].raw='※2';f.project.lessons[1].raw='※3';const result=await buildDistribution(f.project,f.options);assert.equal(result.lessons[0].subject,'延長枠');assert.equal(result.lessons[0].kind,'EXTENSION');assert.equal(result.slotCoverage[1].state,'EXCLUDED');
  f.project.lessons[1].state='EMPTY';await assert.rejects(buildDistribution(f.project,f.options),/配信対象外/);
  f.project.lessons[1].state='PRESENT';f.project.lessons[1].entries=[{...emptyLesson(),subject:'英語'}];f.project.lessons[1].containsExcluded=true;const mixed=await buildDistribution(f.project,f.options);assert.equal(mixed.slotCoverage[1].containsExcluded,true);
});
