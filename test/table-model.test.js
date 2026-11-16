import test from 'node:test';
import assert from 'node:assert/strict';
import { addSourcePreservingEdits, adjacentVisibleSlot, applyReviewPlan, captureHistory, cellProblems, exportConfigForTerm, setExportConfigForTerm, historyUnchanged, matchesSavedSnapshot, missingCalendarRange, missingSlots, nextReviewItem, pasteTableCell, periodCount, placeLegacyEntry, planReviewRange, reviewItems, validClassId } from '../web/table-model.js';

test('export dates remain associated with their term, including older saved projects', () => {
  const project = {term:'S', exportConfig:{'export-start':'2026-04-01','export-end':'2026-09-30','period-1-start':'08:40'}};
  const fall = exportConfigForTerm(project, 'F');
  assert.equal(fall['export-start'], '');
  assert.equal(fall['export-end'], '');
  assert.equal(fall['period-1-start'], '08:40');
  setExportConfigForTerm(project, 'F', {...fall, 'export-start':'2026-10-01','export-end':'2027-03-31'});
  const reopened = JSON.parse(JSON.stringify(project));
  assert.equal(exportConfigForTerm(reopened, 'S')['export-start'], '2026-04-01');
  assert.equal(exportConfigForTerm(reopened, 'F')['export-start'], '2026-10-01');
  assert.equal(exportConfigForTerm(reopened, 'F')['export-end'], '2027-03-31');
});

test('a save does not mark edits made while writing as saved', () => {
  const project = { lessons: [{ subject: '数学' }], sources: [{ name: '時間割.pdf' }] };
  const saved = JSON.stringify(project);
  assert.equal(matchesSavedSnapshot(project, saved), true);
  project.lessons[0].subject = '英語';
  assert.equal(matchesSavedSnapshot(project, saved), false);
  project.lessons[0].subject = '数学';
  assert.equal(matchesSavedSnapshot(project, saved), true);
});

test('period count survives serialization and never hides previously entered rows', () => {
  const project=emptyProject('pdf','test.pdf',2026,'S');
  assert.equal(periodCount(project),4);
  project.periodCount=6;
  project.lessons.push({term:'S',classId:'1-1',day:1,period:7,entries:[emptyLesson()],reviewed:false});
  const reopened=JSON.parse(JSON.stringify(project));
  assert.equal(validProject(reopened),true);
  assert.equal(periodCount(reopened),7);
  reopened.periodCount=13;
  assert.equal(validProject(reopened),false);
});

test('missing slots are scoped to the visible timetable and do not treat confirmed empty slots as missing', () => {
  const project=emptyProject('pdf','test.pdf',2026,'S');project.periodCount=1;
  putLesson(project,{term:'S',classId:'1-1',day:1,period:1,entries:[],state:'EMPTY',reviewed:true});
  putLesson(project,{term:'F',classId:'1-1',day:2,period:1,entries:[emptyLesson()],reviewed:false});
  const missing=missingSlots(project,'lesson','S','1-1','');
  assert.deepEqual(missing.map(s=>s.day),[2,3,4,5]);
  assert.equal(missingSlots(project,'lesson','S','1-2','').length,5);
  assert.equal(project.lessons.length,2);
});

test('missing calendar cells cover only displayed weeks and selected scope', () => {
  const project=emptyProject('pdf','test.pdf',2026,'S');
  project.calendar=[{...emptyDay('2026-04-06'),scope:'1-3'}, {...emptyDay('2026-04-07'),scope:'4-5'}];
  assert.deepEqual(missingSlots(project,'calendar','S','1-1','1-3').map(s=>s.date),['2026-04-07','2026-04-08','2026-04-09','2026-04-10']);
  assert.deepEqual(missingSlots(project,'calendar','S','1-1','none'),[]);
});
import { addSource, emptyDay, emptyLesson, emptyProject, History, lessonAt, migrateV1, migrateV2, putLesson, validProject } from '../web/table-model.js';
import { extractPage, parseCalendarText } from '../web/extract.js';

test('calendar extraction keeps A/B and substitution alongside a source event',()=>{
  assert.deepEqual(parseCalendarText('A 清掃'),{dayType:'A',lessonDay:'',lessonType:'',label:'清掃'});
  assert.deepEqual(parseCalendarText('（金）B高専祭'),{dayType:'B',lessonDay:'5',lessonType:'B',label:'高専祭'});
  assert.deepEqual(parseCalendarText('祝日'),{dayType:'HOLIDAY',lessonDay:'',lessonType:'',label:'祝日'});
  assert.deepEqual(parseCalendarText('AB'),{dayType:'',lessonDay:'',lessonType:'',label:'AB'});
});

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
test('history isolates source metadata and PDF replacements through undo and redo',()=>{
  const project=emptyProject(null,'',2026,'S');
  project.sources.push({id:'one',name:'first.pdf',data:'PDF-A'.repeat(1000),sha256:'',metadata:{tags:['original']}});
  const original=structuredClone(project),history=new History(project);
  history.change(next=>{next.sources[0].data='PDF-B';next.sources[0].metadata.tags.push('edited');next.sources.push({id:'two',name:'second.pdf',data:'PDF-C',sha256:''});});
  assert.deepEqual(project,original);
  assert.equal(history.current.sources[0].data,'PDF-B');assert.deepEqual(history.current.sources[0].metadata.tags,['original','edited']);
  assert.equal(history.undo(),true);assert.deepEqual(history.current,original);
  assert.equal(history.redo(),true);assert.equal(history.current.sources.length,2);assert.equal(history.current.sources[0].data,'PDF-B');
  assert.deepEqual(history.current.sources[0].metadata.tags,['original','edited']);
  assert.throws(()=>history.change(next=>{next.sources[0].metadata.tags.push('failed');throw Error('failed');}),/failed/);
  assert.deepEqual(history.current.sources[0].metadata.tags,['original','edited']);
  history.undo();history.change(next=>{next.sources[0].name='renamed.pdf';});assert.equal(history.redo(),false);
});
test('a failed edit preserves the project and redo history',()=>{
  const history=new History({values:['a']});
  history.change(p=>p.values.push('b'));history.undo();
  assert.throws(()=>history.change(p=>{p.values.push('invalid');throw Error('failed');}),/failed/);
  assert.deepEqual(history.current.values,['a']);
  assert.equal(history.redo(),true);
  assert.deepEqual(history.current.values,['a','b']);
});

test('a pending project load cannot replace edits or undo and redo activity',()=>{
  const history=new History({values:['a']});
  const initial=captureHistory(history);
  assert.equal(historyUnchanged(history,initial),true);
  assert.throws(()=>history.change(()=>{throw Error('invalid edit');}),/invalid edit/);
  assert.equal(historyUnchanged(history,initial),true);
  history.change(p=>p.values.push('b'));
  assert.equal(historyUnchanged(history,initial),false);
  history.undo();
  assert.deepEqual(history.current.values,['a']);
  assert.equal(historyUnchanged(history,initial),false);
  const afterUndo=captureHistory(history);
  history.redo();
  assert.equal(historyUnchanged(history,afterUndo),false);
  assert.equal(historyUnchanged(new History(history.current),captureHistory(history)),false);
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
  assert.match(result.warnings.join(' '),/2年生以上/);
});

test('recognizes the upper-year rows but leaves unsplit text for review',()=>{
  const headers=Array.from({length:20},(_,i)=>item('校時',167+i*48,782));
  const first=[773,747,721,695].flatMap((y,i)=>[item(String(i+1),119,y),item('組',123,y)]);
  const names=['機械','電気・電子','情報','化学・生物'];
  const upper=Array.from({length:16},(_,i)=>item(names[i%4],110,668-i*26));
  const result=extractPage([...headers,...first,...upper,item('数学',167,668),item('教員',167,653),item('別科目',167,642)],1190,842,2026,'F',1);
  const cell=result.lessons.find(c=>c.classId==='2M'&&c.day===1&&c.period===1);
  assert.match(cell.raw,/数学.*教員/);assert.doesNotMatch(cell.raw,/別科目/);
  assert.equal(cell.rawUnparsed,true);assert.equal(cell.reviewed,false);
  assert.match(result.warnings.join(' '),/2年生以上の抽出結果/);
  const malformed=extractPage([...headers,...first,...upper.slice(0,15)],1190,842,2026,'F',1);
  assert.equal(malformed.lessons.some(c=>c.classId==='2M'),false);
});

test('additional PDFs preserve edits and reject overlapping slots atomically',()=>{
  const first={id:'a',name:'lessons.pdf',data:'first',sha256:'a'.repeat(64)}, second={id:'b',name:'calendar.pdf',data:'second',sha256:'b'.repeat(64)};
  const lesson={term:'S',classId:'1-1',day:1,period:1,entries:[{...emptyLesson(),subject:'編集済み'}],reviewed:true,raw:''};
  const initial=addSource(emptyProject(null,'',2026,'S'),first,[lesson],[]);
  const date={...emptyDay('2026-04-06'),scope:'1-3'};
  const combined=addSource(initial,second,[],[date]);
  assert.equal(combined.lessons[0].entries[0].subject,'編集済み');assert.equal(combined.calendar[0].sourceId,'b');assert.equal(validProject(combined),true);
  const reopened=JSON.parse(JSON.stringify(combined));assert.equal(validProject(reopened),true);assert.equal(reopened.sources.length,2);assert.equal(reopened.lessons[0].entries[0].subject,'編集済み');
  assert.throws(()=>addSource(initial,second,[lesson],[]),/同じ枠/);assert.equal(initial.sources.length,1);assert.equal(initial.lessons[0].reviewed,true);
  assert.throws(()=>addSource(initial,{...second,sha256:first.sha256},[],[]),/追加済み/);
});
test('explicitly reviewed empty slot remains represented',()=>{
  const p=emptyProject('pdf','test.pdf',2026,'S');putLesson(p,{term:'S',classId:'1-1',day:1,period:1,entries:[],reviewed:true,raw:''});
  assert.deepEqual(lessonAt(p,'S','1-1',1,1).entries,[]);assert.equal(validProject(p),true);
});
test('version 2 projects migrate without losing lessons or source PDF',()=>{
  const old={version:2,pdf:'pdf',pdfName:'test.pdf',year:2026,term:'S',lessons:[{term:'S',classId:'1-1',day:1,period:1,entries:[emptyLesson()],reviewed:true}],calendar:[],legacyCells:[]};
  const converted=migrateV2(old);assert.equal(converted.sources[0].data,'pdf');assert.equal(converted.lessons[0].sourceId,'legacy');assert.equal(validProject(converted),true);
});


test('adding an overlapping PDF keeps existing edits and adds non-overlapping records', () => {
  const source={id:'first',name:'one.pdf',data:'a',sha256:'a'.repeat(64)};
  const initial=addSource(emptyProject(null,'',2026,'S'),source,[],[]);
  const existing={term:'S',classId:'1-1',day:1,period:1,entries:[{...emptyLesson(),subject:'修正済み'}],reviewed:true,raw:''};
  const existingDay={...emptyDay('2026-04-06'),scope:'1-3',dayType:'A',reviewed:true};
  initial.lessons.push({...existing,sourceId:'first'});initial.calendar.push({...existingDay,sourceId:'first'});
  const second={id:'second',name:'two.pdf',data:'b',sha256:'b'.repeat(64)};
  const incoming={...existing,entries:[{...emptyLesson(),subject:'抽出'}],reviewed:false};
  const merged=addSourcePreservingEdits(initial,second,[incoming,{...incoming,day:2},{...incoming,day:2}],
    [{...existingDay,dayType:'B'},{...existingDay,date:'2026-04-07'}]);
  assert.equal(merged.skippedLessons,2);assert.equal(merged.skippedDays,1);
  assert.equal(merged.project.lessons[0].entries[0].subject,'修正済み');assert.equal(merged.project.lessons[0].reviewed,true);
  assert.equal(merged.project.calendar[0].dayType,'A');assert.equal(merged.project.calendar[0].reviewed,true);
  assert.equal(merged.project.lessons[1].sourceId,'second');assert.equal(merged.project.calendar[1].sourceId,'second');
  assert.equal(initial.sources.length,1);assert.equal(initial.lessons.length,1);assert.equal(validProject(merged.project),true);
  assert.throws(()=>addSourcePreservingEdits(initial,{...second,sha256:source.sha256},[],[]),/追加済み/);
});

test('class selection accepts advanced classes without allowing invalid identifiers', () => {
  for(const id of ['1-1','3I','AC-1','AC-ME2'])assert.equal(validClassId(id),true,id);
  for(const id of ['2-M','6I','AC-','AC-1/2','', '1-5'])assert.equal(validClassId(id),false,id);
});

test('arrow navigation stays within displayed calendar weeks, including weekends', () => {
  const project=emptyProject('pdf','test.pdf',2026,'S');project.periodCount=4;
  const lesson={kind:'lesson',day:5,period:1};
  assert.deepEqual(adjacentVisibleSlot(project,lesson,'', 'ArrowRight'),lesson);
  assert.deepEqual(adjacentVisibleSlot(project,lesson,'', 'ArrowDown'),{...lesson,period:2});
  project.calendar=[{...emptyDay('2026-04-06'),scope:'1-3'}, {...emptyDay('2026-04-20'),scope:'1-3'}];
  const friday={kind:'calendar',date:'2026-04-10'};
  assert.deepEqual(adjacentVisibleSlot(project,friday,'1-3','ArrowRight'),{...friday,date:'2026-04-11'});
  const sunday={kind:'calendar',date:'2026-04-12'};
  assert.deepEqual(adjacentVisibleSlot(project,sunday,'1-3','ArrowRight'),sunday);
  assert.deepEqual(adjacentVisibleSlot(project,sunday,'1-3','ArrowLeft'),{...sunday,date:'2026-04-11'});
  assert.deepEqual(adjacentVisibleSlot(project,friday,'1-3','ArrowDown'),friday);
  assert.deepEqual(adjacentVisibleSlot(project,friday,'1-3','ArrowLeft'),{...friday,date:'2026-04-09'});
  const wrongScope={kind:'calendar',date:'2026-04-06'};
  assert.deepEqual(adjacentVisibleSlot(project,wrongScope,'other','ArrowDown'),wrongScope);
});


test('calendar range adds only missing weekdays as unreviewed without inventing provenance', () => {
  const project=emptyProject('pdf','test.pdf',2026,'S');
  const existing={...emptyDay('2026-04-07'),scope:'1-3',dayType:'B',reviewed:true,sourceId:'legacy',sourcePage:2};
  const other={...emptyDay('2026-04-08'),scope:'4-5',dayType:'A',reviewed:true};
  project.calendar=[existing,other];
  const cells=missingCalendarRange(project,'1-3','2026-04-06','2026-04-13');
  assert.deepEqual(cells.map(c=>c.date),['2026-04-06','2026-04-08','2026-04-09','2026-04-10','2026-04-13']);
  assert.ok(cells.every(c=>!c.reviewed&&c.dayType===''&&c.sourceId===''&&c.sourcePage===null));
  assert.equal(project.calendar.length,2);assert.equal(project.calendar[0].dayType,'B');
  const history=new History(project);history.change(p=>p.calendar.push(...cells));assert.equal(history.current.calendar.length,7);
  history.undo();assert.deepEqual(history.current.calendar,project.calendar);
  history.redo();assert.equal(history.current.calendar.length,7);
});

test('calendar range accepts explicit source only and validates dates and year boundaries', () => {
  const project=emptyProject('pdf','test.pdf',2026,'S');
  const cells=missingCalendarRange(project,'1-3','2027-03-30','2027-03-31','legacy',3);
  assert.equal(cells.length,2);assert.ok(cells.every(c=>c.sourceId==='legacy'&&c.sourcePage===3&&!c.reviewed));
  assert.throws(()=>missingCalendarRange(project,'','2026-04-06','2026-04-10'),/対象/);
  for(const [start,end] of [['2026-02-30','2026-04-10'],['2026-04-10','2026-04-06'],['2026-03-31','2026-04-10'],['2027-03-31','2027-04-01']])
    assert.throws(()=>missingCalendarRange(project,'1-3',start,end),/期間/);
  assert.throws(()=>missingCalendarRange(project,'1-3','2026-04-06','2026-04-10','missing',1),/PDF/);
  assert.throws(()=>missingCalendarRange(project,'1-3','2026-04-06','2026-04-10','legacy',0),/PDF/);
  assert.deepEqual(missingCalendarRange(project,'1-3','2026-04-11','2026-04-12'),[]);
});


test('pasting lesson cells keeps source when available, regenerates IDs and requires review', () => {
  const project=emptyProject('pdf','test.pdf',2026,'S');
  const original={term:'S',classId:'1-1',day:1,period:1,entries:[{...emptyLesson(),id:'first',subject:'数学'}],reviewed:true,raw:'数学',sourceId:'legacy',sourcePage:1};
  const payload={format:'sktjf-table-cell',kind:'lesson',cell:original};
  const destination={kind:'lesson',term:'F',classId:'2I',day:3,period:2};
  const result=pasteTableCell(project,payload,destination,()=> 'new-id');
  assert.equal(result.sourceMissing,false);
  const pasted=lessonAt(project,'F','2I',3,2);assert.equal(pasted.entries[0].id,'new-id');
  assert.equal(pasted.entries[0].subject,'数学');assert.equal(pasted.sourceId,'legacy');assert.equal(pasted.reviewed,false);
  assert.equal(original.entries[0].id,'first');assert.equal(original.reviewed,true);
});

test('pasting clears unavailable sources and rejects malformed cells without damaging history', () => {
  const project=emptyProject('pdf','test.pdf',2026,'S');
  const original={term:'S',classId:'1-1',day:1,period:1,entries:[{subject:'数学'}],reviewed:true,raw:'数学',sourceId:'other',sourcePage:4};
  const payload={format:'sktjf-table-cell',kind:'lesson',cell:original};
  const destination={kind:'lesson',term:'S',classId:'1-1',day:2,period:1};
  const history=new History(project);let result;
  history.change(p=>{result=pasteTableCell(p,payload,destination,()=> 'new-id');});
  assert.equal(result.sourceMissing,true);assert.equal(history.current.lessons[0].sourceId,'');
  assert.equal(history.current.lessons[0].sourcePage,null);assert.equal(history.current.lessons[0].entries[0].teacher,'');
  history.undo();assert.equal(history.current.lessons.length,0);
  assert.throws(()=>history.change(p=>pasteTableCell(p,{...payload,cell:{...original,entries:[{subject:42}]}},destination)),/セル/);
  assert.equal(history.current.lessons.length,0);assert.equal(history.redo(),true);
});

test('pasting calendar cells changes only target date and scope and rejects invalid content', () => {
  const project=emptyProject('pdf','test.pdf',2026,'S');
  const cell={...emptyDay('2026-04-06'),scope:'1-3',dayType:'A',reviewed:true,sourceId:'legacy',sourcePage:1};
  project.calendar.push(cell);
  const payload={format:'sktjf-table-cell',kind:'calendar',cell};
  const dest={kind:'calendar',scope:'4-5',date:'2026-04-07'};
  pasteTableCell(project,payload,dest);assert.equal(project.calendar.length,2);
  assert.equal(project.calendar[1].dayType,'A');assert.equal(project.calendar[1].reviewed,false);
  const history=new History(project);
  assert.throws(()=>history.change(p=>pasteTableCell(p,{...payload,cell:{...cell,eventKind:23}},dest)),/セル/);
  assert.equal(history.current.calendar.length,2);
  assert.throws(()=>history.change(p=>pasteTableCell(p,payload,{...dest,date:'2026-02-30'})),/セル/);
});

test('review queue retains confirmed cells with structural problems until corrected',()=>{
  const project=emptyProject('pdf','test.pdf',2026,'S');
  const entry={...emptyLesson(),subject:'数学',attributes:'DD',excludedAttributes:'DD'};
  const lesson={term:'S',classId:'1-1',day:1,period:1,entries:[entry],reviewed:true,raw:'',sourceId:'legacy',sourcePage:1};
  const day={...emptyDay('2026-04-06'),scope:'1-3',dayType:'HOLIDAY',lessonDay:'1',reviewed:true,sourceId:'legacy',sourcePage:1};
  project.lessons=[lesson];project.calendar=[day];
  assert.match(cellProblems(project,'lesson',lesson).join(' '),/属性/);
  assert.match(cellProblems(project,'calendar',day).join(' '),/休日/);
  assert.deepEqual(reviewItems(project).map(item=>item.kind),['lesson','calendar']);
  entry.excludedAttributes='';day.lessonDay='';
  assert.deepEqual(reviewItems(project),[]);
  lesson.reviewed=false;
  assert.equal(reviewItems(project).length,1);
});

test('local checks identify missing references, footnotes and incomplete calendar entries',()=>{
  const project=emptyProject('pdf','test.pdf',2026,'S');
  const lesson={term:'S',classId:'1-1',day:1,period:1,entries:[{...emptyLesson(),subject:'※3'}],reviewed:true,raw:'※3',sourceId:'',sourcePage:null};
  assert.match(cellProblems(project,'lesson',lesson).join(' '),/PDF/);
  assert.match(cellProblems(project,'lesson',lesson).join(' '),/配信対象外/);
  const day={...emptyDay('2026-04-06'),scope:'1-3',lessonType:'A',eventKind:'MIDTERM',reviewed:true,sourceId:'legacy',sourcePage:1};
  const problems=cellProblems(project,'calendar',day).join(' ');
  assert.match(problems,/A\/B/);assert.match(problems,/振替先/);assert.match(problems,/行事名/);
  const extension={...lesson,entries:[{...emptyLesson(),subject:'※ ２',special:'EXTENSION'}],raw:'',sourceId:'legacy',sourcePage:1};
  assert.deepEqual(cellProblems(project,'lesson',extension),[]);
});

test('review queue flags a source page beyond the actual PDF without guessing unknown counts',()=>{
  const project=emptyProject('pdf','test.pdf',2026,'S');
  const lesson={term:'S',classId:'1-1',day:1,period:1,entries:[{...emptyLesson(),subject:'数学'}],reviewed:true,raw:'',sourceId:'legacy',sourcePage:3};
  project.lessons=[lesson];
  assert.deepEqual(reviewItems(project),[]);
  const counts=new Map([['legacy',2]]);
  assert.match(cellProblems(project,'lesson',lesson,counts).join(' '),/参照ページ/);
  assert.equal(reviewItems(project,counts).length,1);
  lesson.sourcePage=2;
  assert.deepEqual(reviewItems(project,counts),[]);
  const day={...emptyDay('2026-04-06'),scope:'1-3',dayType:'A',reviewed:true,sourceId:'legacy',sourcePage:4};
  assert.match(cellProblems(project,'calendar',day,counts).join(' '),/参照ページ/);
});

test('review traversal continues after a confirmed or removed cell in stable table order',()=>{
  const project=emptyProject('pdf','test.pdf',2026,'S');
  const lesson=(day,period)=>({term:'S',classId:'1-1',day,period,entries:[{...emptyLesson(),subject:'数学'}],reviewed:false,raw:'',sourceId:'legacy',sourcePage:1});
  const first=lesson(1,1),middle=lesson(2,1),last=lesson(1,2);
  const day1={...emptyDay('2026-04-06'),scope:'1-3',dayType:'A',sourceId:'legacy',sourcePage:1};
  const day2={...emptyDay('2026-04-07'),scope:'1-3',dayType:'B',sourceId:'legacy',sourcePage:1};
  project.lessons=[last,middle,first];project.calendar=[day2,day1];
  const selected=cell=>({kind:'lesson',term:cell.term,classId:cell.classId,day:cell.day,period:cell.period});
  assert.equal(nextReviewItem(project,null).c,first);
  assert.equal(nextReviewItem(project,selected(first)).c,middle);
  middle.reviewed=true;
  assert.equal(nextReviewItem(project,selected(middle)).c,last);
  project.lessons=project.lessons.filter(cell=>cell!==middle);
  assert.equal(nextReviewItem(project,selected(middle)).c,last);
  assert.equal(nextReviewItem(project,selected(last)).c,day1);
  day1.reviewed=true;
  assert.equal(nextReviewItem(project,{kind:'calendar',scope:day1.scope,date:day1.date}).c,day2);
  assert.equal(nextReviewItem(project,{kind:'calendar',scope:day2.scope,date:day2.date}).c,first);
  first.reviewed=true;last.reviewed=true;day2.reviewed=true;
  assert.equal(nextReviewItem(project,null),null);
});
test('bulk review confirms only valid existing lessons in the selected range and is undoable',()=>{
  const project=emptyProject('pdf','test.pdf',2026,'S');
  const lesson=(day,overrides={})=>({term:'S',classId:'1-1',day,period:1,entries:[{...emptyLesson(),subject:'数学'}],reviewed:false,raw:'',sourceId:'legacy',sourcePage:1,...overrides});
  project.lessons=[lesson(1),lesson(2,{sourcePage:2}),lesson(3,{entries:[{...emptyLesson(),subject:''}]}),lesson(1,{classId:'1-2'})];
  const range={kind:'lesson',term:'S',classId:'1-1',firstDay:1,lastDay:4,firstPeriod:1,lastPeriod:1},counts=new Map([['legacy',1]]);
  const plan=planReviewRange(project,range,true,counts);
  assert.deepEqual(plan.stats,{changed:1,unchanged:0,missing:1,problems:2});
  const history=new History(project);history.change(p=>applyReviewPlan(p,plan));
  assert.equal(history.current.lessons[0].reviewed,true);assert.ok(history.current.lessons.slice(1).every(cell=>!cell.reviewed));
  history.undo();assert.deepEqual(history.current,project);history.redo();
  const reset=planReviewRange(history.current,range,false,counts);assert.equal(reset.stats.changed,1);
  history.change(p=>applyReviewPlan(p,reset));assert.ok(history.current.lessons.every(cell=>!cell.reviewed));
});
test('bulk calendar review respects scope, date bounds and optional empty weekends',()=>{
  const project=emptyProject('pdf','test.pdf',2026,'S');
  const day=(date,scope,overrides={})=>({...emptyDay(date),scope,dayType:'A',sourceId:'legacy',sourcePage:1,...overrides});
  project.calendar=[day('2026-04-06','1-3'),day('2026-04-07','1-3',{dayType:''}),day('2026-04-11','1-3'),day('2026-04-06','4-5')];
  const range={kind:'calendar',scope:'1-3',start:'2026-04-06',end:'2026-04-12'},plan=planReviewRange(project,range,true,new Map([['legacy',1]]));
  assert.deepEqual(plan.stats,{changed:2,unchanged:0,missing:3,problems:1});applyReviewPlan(project,plan);
  assert.deepEqual(project.calendar.map(cell=>cell.reviewed),[true,false,true,false]);
  assert.throws(()=>planReviewRange(project,{...range,start:'2027-04-01'},true),/範囲/);
});
test('bulk review skips unseparated extracted A/B text until it is corrected',()=>{
  const project=emptyProject('pdf','test.pdf',2026,'S');
  const raw='A 数学/B 英語';
  project.lessons=[{term:'S',classId:'1-1',day:1,period:1,entries:[{...emptyLesson(),subject:raw}],reviewed:false,raw,sourceId:'legacy',sourcePage:1}];
  const range={kind:'lesson',term:'S',classId:'1-1',firstDay:1,lastDay:1,firstPeriod:1,lastPeriod:1};
  let plan=planReviewRange(project,range,true);assert.equal(plan.stats.problems,1);assert.equal(plan.stats.changed,0);
  project.lessons[0].entries=[{...emptyLesson(),subject:'数学',cycle:'A'},{...emptyLesson(),subject:'英語',cycle:'B'}];
  plan=planReviewRange(project,range,true);assert.equal(plan.stats.changed,1);applyReviewPlan(project,plan);assert.equal(project.lessons[0].reviewed,true);
});

test('unplaced legacy lessons can be assigned one at a time with source and warnings preserved',()=>{
  const legacy={id:'old',page:2,kind:'lesson',rect:[0,0,1,1],reviewed:true,issues:['範囲を確認'],entries:[
    {subject:'数学',teacher:'先生',classId:'1-1',day:'月',period:'1'},
    {subject:'英語',teacher:'講師',classId:'1-1',day:'月',period:'1'}]};
  const project=migrateV1({pdf:'pdf',pdfName:'old.pdf',cells:[legacy]},2026,'S');
  const history=new History(project),destination={kind:'lesson',term:'S',classId:'1-1',day:1,period:1};
  history.change(p=>placeLegacyEntry(p,0,0,destination,()=> 'new-1'));
  assert.equal(history.current.legacyCells[0].entries.length,1);
  let slot=lessonAt(history.current,'S','1-1',1,1);
  assert.equal(slot.entries[0].subject,'数学');assert.equal(slot.entries[0].classId,'1-1');assert.equal(slot.entries[0].id,'new-1');
  assert.equal(slot.sourceId,'legacy');assert.equal(slot.sourcePage,2);assert.equal(slot.reviewed,false);
  history.change(p=>placeLegacyEntry(p,0,0,destination,()=> 'new-2'));
  slot=lessonAt(history.current,'S','1-1',1,1);
  assert.deepEqual(slot.entries.map(e=>e.subject),['数学','英語']);
  assert.deepEqual(slot.legacyRecords.map(record=>record.entries[0].subject),['数学','英語']);
  assert.deepEqual(slot.legacyRecords[0].rect,legacy.rect);assert.equal(slot.legacyRecords[0].reviewed,true);
  assert.deepEqual(JSON.parse(JSON.stringify(history.current)).lessons[0].legacyRecords,slot.legacyRecords);
  assert.equal(history.current.legacyCells.length,0);assert.match(history.current.warnings[0].message,/範囲を確認/);
  history.undo();assert.equal(history.current.legacyCells[0].entries[0].subject,'英語');
  assert.equal(lessonAt(history.current,'S','1-1',1,1).entries.length,1);
  assert.equal(project.legacyCells[0].entries.length,2);
});

test('legacy assignment preserves existing calendar and differently sourced lesson cells',()=>{
  const lesson={id:'old',page:1,kind:'lesson',issues:[],entries:[{subject:'数学'}]};
  const project=migrateV1({pdf:'pdf',pdfName:'old.pdf',cells:[lesson]},2026,'S');
  project.sources.push({id:'other',name:'other.pdf',data:'pdf',sha256:''});
  putLesson(project,{term:'S',classId:'1-1',day:1,period:1,entries:[{...emptyLesson(),subject:'編集済み'}],reviewed:true,sourceId:'other',sourcePage:1});
  const history=new History(project),destination={kind:'lesson',term:'S',classId:'1-1',day:1,period:1};
  assert.throws(()=>history.change(p=>placeLegacyEntry(p,0,0,destination)),/別の内容/);
  assert.equal(history.current.legacyCells.length,1);assert.equal(history.current.lessons[0].entries[0].subject,'編集済み');
  const oldDay={id:'date',page:1,kind:'calendar',issues:[],entries:[{date:'2026-04-06',dayType:'A',lessonDay:'',lessonType:'',label:''}]};
  const dates=migrateV1({pdf:'pdf',pdfName:'old.pdf',cells:[oldDay]},2026,'S');
  const dayDestination={kind:'calendar',date:'2026-04-06',scope:'1-3'};
  placeLegacyEntry(dates,0,0,dayDestination);
  assert.equal(dates.calendar[0].dayType,'A');assert.equal(dates.calendar[0].reviewed,false);
  assert.equal(dates.calendar[0].legacyRecords[0].entries[0].date,'2026-04-06');
  dates.legacyCells.push(structuredClone(oldDay));const before=JSON.stringify(dates);
  assert.throws(()=>placeLegacyEntry(dates,0,0,dayDestination),/別の内容/);assert.equal(JSON.stringify(dates),before);
});
