import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStrictJson } from '../lib/strict-json.js';

test('rejects duplicate object keys, including escaped spellings and nested objects',()=>{
  for(const text of ['{"id":1,"id":2}',String.raw`{"id":1,"\u0069d":2}`,'{"a":[{"x":1,"x":2}]}'])
    assert.throws(()=>parseStrictJson(Buffer.from(text),4096),/重複/);
  assert.deepEqual(parseStrictJson(Buffer.from('{"a":[{"x":1},{"x":2}],"text":"a\\\"b"}'),4096),{a:[{x:1},{x:2}],text:'a"b'});
});

test('enforces UTF-8, root object, size and Android-compatible depth and node limits',()=>{
  assert.throws(()=>parseStrictJson(Buffer.from([0x7b,0x22,0x61,0x22,0x3a,0x22,0xff,0x22,0x7d]),4096),/文字コード/);
  assert.throws(()=>parseStrictJson(Buffer.from('[]'),4096),/形式/);
  assert.throws(()=>parseStrictJson(Buffer.from('{}'),1),/サイズ/);
  assert.throws(()=>parseStrictJson(Buffer.from('{"x":'+ '['.repeat(33)+'0'+']'.repeat(33)+'}'),4096),/構造/);
  assert.throws(()=>parseStrictJson(Buffer.from('{"x":['+'0,'.repeat(100_000)+'0]}'),1024*1024),/構造/);
  assert.throws(()=>parseStrictJson(Buffer.from([0xef,0xbb,0xbf,0x7b,0x7d]),4096));
});
