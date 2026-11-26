import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.mjs';
import { fixture } from './support/synthetic.js';
import {putSelectionGroup} from '../web/table-model.js';

test('server confines files and rejects cross-origin export requests',async t=>{
  const server=createAppServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const address=`http://127.0.0.1:${server.address().port}`,headers={};
  const home=await fetch(address+'/',{headers});assert.equal(home.status,200);
  const traversal=await fetch(address+'/web/%2e%2e%2fpackage.json',{headers});assert.equal(traversal.status,404);
  const foreign=await fetch(address+'/api/export',{method:'POST',headers:{...headers,Origin:'https://example.com','Content-Type':'application/json'},body:'{}'});assert.equal(foreign.status,404);
  const local=await fetch(address+'/api/export',{method:'POST',headers:{...headers,Origin:address,'Content-Type':'application/json'},body:'{}'});assert.equal(local.status,400);
  const exportResponse=await fetch(address+'/api/export',{method:'POST',headers:{Origin:address,'Content-Type':'application/json'},body:JSON.stringify(fixture())});assert.equal(exportResponse.status,200);const result=await exportResponse.json();assert.equal(result.data.classId,'1-1');assert.equal(result.data.slotCoverage[1].state,'EXCLUDED');
});

test('server exports reviewed selection groups without dropping membership',async t=>{
  const server=createAppServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const address=`http://127.0.0.1:${server.address().port}`, input=fixture(), cell=input.project.lessons[0];
  cell.entries.push({...cell.entries[0],id:'alternative',subject:'選択授業'});
  putSelectionGroup(input.project,{term:'S',classId:'1-1',day:1,period:1,lessonIds:['stable-id','alternative'],id:'group'}).reviewed=true;
  const response=await fetch(address+'/api/export',{method:'POST',headers:{Origin:address,'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal(response.status,200);const {data}=await response.json();
  assert.equal(data.schemaVersion,3);assert.deepEqual(data.selectionGroups[0].lessonIds,['stable-id','alternative']);
});
