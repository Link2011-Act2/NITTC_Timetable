import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLesson, emptyProject, putLesson, putSelectionGroup, validProject } from '../web/table-model.js';

test('explicit groups survive project save and changes require review', () => {
  const project=emptyProject('pdf','timetable.pdf',2026,'S');
  const entries=[{...emptyLesson(),id:'a',subject:'A'},{...emptyLesson(),id:'b',subject:'B'}];
  const cell={term:'S',classId:'2M',day:1,period:1,entries,reviewed:true,raw:'',sourceId:'legacy',sourcePage:1};
  putLesson(project,cell);
  assert.equal(project.selectionGroups,undefined);
  putSelectionGroup(project,{term:'S',classId:'2M',day:1,period:1,lessonIds:['a','b'],id:'group'});
  project.selectionGroups[0].reviewed=true;
  const reopened=JSON.parse(JSON.stringify(project));
  assert.equal(validProject(reopened),true);
  putLesson(reopened,{...cell,entries:[entries[0],{...entries[1],subject:'C'}]});
  assert.equal(reopened.selectionGroups[0].reviewed,false);
  assert.deepEqual(reopened.selectionGroups[0].lessonIds,['a','b']);
});

test('selection groups reject different slots and A/B alternatives', () => {
  const project=emptyProject('pdf','timetable.pdf',2026,'S');
  putLesson(project,{term:'S',classId:'2M',day:1,period:1,entries:[
    {...emptyLesson(),id:'a',subject:'A',cycle:'A'}, {...emptyLesson(),id:'b',subject:'B',cycle:'B'}
  ],reviewed:false,raw:'',sourceId:'legacy',sourcePage:1});
  assert.throws(()=>putSelectionGroup(project,{term:'S',classId:'2M',day:1,period:1,lessonIds:['a','b'],id:'group'}));
  assert.throws(()=>putSelectionGroup(project,{term:'S',classId:'2M',day:2,period:1,lessonIds:['a','b'],id:'group'}));
});
