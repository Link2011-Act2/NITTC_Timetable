import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDay, emptyLesson, emptyProject, History, lessonAt, migrateV1, putLesson, validProject } from '../web/table-model.js';
import { extractPage } from '../web/extract.js';

const item=(str,x,y)=>({str,transform:[1,0,0,1,x,y]});
test('calendar extraction keeps date, substitution and unconfirmed source',()=>{
  const data=[item('1・2・3年生',320,768),...['月','火','水','木','金'].map((s,i)=>item(s,240+i*65,718)),item('5月4日',60,586),item('5月8日',160,586),item('祝日',240,586),item('（水）B',435,586)];
  const result=extractPage(data,595,842,2026,'S',1);
  assert.equal(result.calendar.length,5);
  const holiday=result.calendar.find(c=>c.date==='2026-05-04');assert.equal(holiday.dayType,'HOLIDAY');assert.equal(holiday.reviewed,false);
  const transfer=result.calendar.find(c=>c.date==='2026-05-07');assert.equal(transfer.lessonDay,'3');assert.equal(transfer.lessonType,'B');assert.equal(transfer.raw,'（水）B');
});
test('lesson edits keep independent slots and support undo',()=>{
  const history=new History(emptyProject('pdf','test.pdf',2026,'S'));
  const entry={...emptyLesson(),subject:'数学'};
  history.change(p=>putLesson(p,{term:'S',classId:'1-1',day:1,period:1,entries:[entry],reviewed:false,raw:''}));
  history.change(p=>putLesson(p,{term:'S',classId:'1-1',day:1,period:1,entries:[entry,{...entry,attributes:'DD'}],reviewed:false,raw:''}));
  assert.equal(lessonAt(history.current,'S','1-1',1,1).entries.length,2);
  history.undo();assert.equal(lessonAt(history.current,'S','1-1',1,1).entries.length,1);
  history.redo();assert.equal(lessonAt(history.current,'S','1-1',1,1).entries.length,2);
});
test('legacy data remains available without assigning guessed positions',()=>{
  const old={pdf:'pdf',pdfName:'test.pdf',cells:[{entries:[{subject:'理科'}]}]};
  const next=migrateV1(old,2027,'F');assert.equal(next.legacyCells[0].entries[0].subject,'理科');assert.equal(next.lessons.length,0);assert.equal(next.year,2027);assert.equal(validProject(next),true);
});
test('project shape rejects duplicate timetable and calendar keys',()=>{
  const p=emptyProject('pdf','test.pdf',2026,'S');const day={...emptyDay('2026-05-04'),scope:'1-3'};p.calendar=[day,day];assert.equal(validProject(p),false);
  p.calendar=[{...day,date:'2026-02-30'}];assert.equal(validProject(p),false);
});

test('lesson extraction includes lower teacher line without reading next class',()=>{
  const headers=Array.from({length:20},(_,i)=>item('校時',167+i*48,782));
  const anchors=[773,747,721,695].flatMap((y,i)=>[item(String(i+1),119,y),item('組',123,y)]);
  const result=extractPage([...headers,...anchors,item('国語',200,773),item('百井',200,756),item('別クラス',200,747)],1190,842,2026,'S',1);
  const cell=result.lessons.find(c=>c.classId==='1-1'&&c.day===1&&c.period===2);
  assert.match(cell.raw,/国語/);assert.match(cell.raw,/百井/);assert.doesNotMatch(cell.raw,/別クラス/);assert.equal(cell.reviewed,false);
});
