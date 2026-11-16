import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSktjf, serializeSktjf, validateSktjf } from '../lib/validator.js';

// Synthetic fixture: this does not represent a school timetable.
function sample(){return {format:'SKTJF',schemaVersion:1,schoolId:'nittc',academicYear:2026,term:{code:'S',start:'2026-04-06',end:'2026-04-10'},classId:'1-1',revision:'2026.S.0',sources:[{id:'source-1',name:'synthetic.pdf',sha256:'a'.repeat(64)}],periods:[{number:1,start:'08:40',end:'10:10'}],slotCoverage:Array.from({length:5},(_,i)=>({dayOfWeek:i+1,period:1,state:i===0?'PRESENT':'EMPTY',sources:[{sourceId:'source-1',page:1}]})),lessons:[{id:'lesson-1',dayOfWeek:1,period:1,cycle:'A',subject:'数学',teachers:[],rooms:[],conditions:{all:[],none:[]},kind:'NORMAL',sources:[{sourceId:'source-1',page:1}]},{id:'lesson-2',dayOfWeek:1,period:1,cycle:'A',subject:'理科',teachers:[],rooms:[],conditions:{all:['DD'],none:[]},kind:'NORMAL',sources:[{sourceId:'source-1',page:1}]}],calendar:Array.from({length:5},(_,i)=>({date:`2026-04-${String(i+6).padStart(2,'0')}`,dayType:'A',sources:[{sourceId:'source-1',page:1}]}))};}
test('schema accepts simultaneous conditional lessons and round trips',()=>{const data=sample();assert.deepEqual(validateSktjf(data),[]);assert.deepEqual(parseSktjf(serializeSktjf(data)),data);});
test('rejects unsupported versions, wrong class IDs and malformed dates',()=>{for(const mutate of [d=>d.schemaVersion=2,d=>d.classId='2-M',d=>d.calendar[0].date='2026-02-30']){const data=sample();mutate(data);assert.ok(validateSktjf(data).length);}});
test('rejects missing references, duplicate ids and contradictory conditions',()=>{const data=sample();data.lessons[1].id='lesson-1';data.lessons[0].sources[0].sourceId='missing';data.lessons[1].conditions.none=['DD'];const errors=validateSktjf(data).join('\n');assert.match(errors,/重複/);assert.match(errors,/不明な出典/);assert.match(errors,/矛盾/);});
test('rejects revision mismatch, unknown period and excluded footnotes',()=>{const data=sample();data.revision='2026.F.1';data.lessons[0].period=2;data.lessons[1].subject='※3';const errors=validateSktjf(data).join('\n');assert.match(errors,/revision/);assert.match(errors,/不明な時限/);assert.match(errors,/脚注/);});
test('rejects dates outside term and invalid substitutions',()=>{const data=sample();data.calendar.push({date:'2026-10-01',dayType:'HOLIDAY',overrideDayOfWeek:1,sources:[{sourceId:'source-1',page:1}]});const errors=validateSktjf(data).join('\n');assert.match(errors,/範囲外/);assert.match(errors,/休日/);});
test('special lesson labels and kinds must agree',()=>{const data=sample();data.lessons[0].subject='補講';assert.match(validateSktjf(data).join('\n'),/種別/);data.lessons[0].kind='MAKEUP';assert.deepEqual(validateSktjf(data),[]);});
test('rejects overlapping periods and inconsistent slot coverage',()=>{const data=sample();data.periods.push({number:2,start:'09:00',end:'10:30'});data.slotCoverage[0].state='EMPTY';const errors=validateSktjf(data).join('\n');assert.match(errors,/重な/);assert.match(errors,/一致/);});
test('rejects incomplete weekday coverage and dates without content',()=>{
  let data=sample();data.slotCoverage.pop();assert.match(validateSktjf(data).join('\n'),/slotCoverage 5\/1: 枠がありません/);
  data=sample();data.calendar.pop();assert.match(validateSktjf(data).join('\n'),/calendar 2026-04-10: 日付がありません/);
  data=sample();data.calendar[0].dayType=null;assert.match(validateSktjf(data).join('\n'),/日付の内容がありません/);
  data.calendar[0].event={name:'学校行事',kind:'EVENT'};assert.deepEqual(validateSktjf(data),[]);
  data.term.end='2026-04-12';assert.deepEqual(validateSktjf(data),[]);
});
test('checks Android consumer limits on names, attributes, references and page numbers',()=>{
  let data=sample();data.sources[0].name='a'.repeat(512);data.lessons[0].subject='a'.repeat(1000);data.lessons[0].teachers=['t'.repeat(1024)];
  assert.deepEqual(validateSktjf(data),[]);
  for(const mutate of [
    d=>d.sources[0].name='a'.repeat(513),d=>d.lessons[0].subject='a'.repeat(1001),
    d=>d.lessons[0].teachers=[' '],d=>d.lessons[0].rooms=Array(65).fill('room'),
    d=>d.lessons[0].conditions.all=Array.from({length:65},(_,i)=>`a${i}`),
    d=>d.lessons[0].sources[0].page=100001,d=>d.lessons[0].sources[0].note='x'.repeat(1025),
    d=>d.calendar[0].event={name:'x'.repeat(1001),kind:'EVENT'}
  ]){data=sample();mutate(data);assert.ok(validateSktjf(data).length);}
});
test('serialization rejects data exceeding the consumer JSON node limit',()=>{
  const data=sample(),base=data.lessons[0];
  data.lessons=Array.from({length:800},(_,i)=>({...base,id:`lesson-${i}`,teachers:Array(64).fill('t'),rooms:Array(64).fill('r')}));
  assert.deepEqual(validateSktjf(data),[]);
  assert.throws(()=>serializeSktjf(data),/構造/);
});
