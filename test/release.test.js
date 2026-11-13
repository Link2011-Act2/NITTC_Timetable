import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleRelease, validateRelease } from '../lib/release.js';
import { fixture } from './support/synthetic.js';

function releaseInput(){
  const first=fixture(),second=structuredClone(first);for(const cell of second.project.lessons)cell.classId='1-2';second.options.classId='1-2';
  return {academicYear:2026,term:'S',revision:'2026.S.0',publishedAt:'2026-04-01T00:00:00Z',releaseBaseUrl:'https://github.com/example/SKTJF/releases/download/2026.S.0/',expectedClasses:['1-1','1-2'],entries:[first,second]};
}
test('generates a manifest and exact class assets from reviewed projects',async()=>{
  const input=releaseInput(),{manifest,files}=await assembleRelease(input);
  assert.deepEqual(validateRelease(manifest,files,input.expectedClasses),[]);assert.deepEqual([...files.keys()],['1-1.sktjf.json','1-2.sktjf.json']);
  assert.equal(manifest.assets[0].url,'https://github.com/example/SKTJF/releases/download/2026.S.0/1-1.sktjf.json');assert.equal(files.get('1-1.sktjf.json').includes(Buffer.from('%PDF')),false);
});
test('rejects missing classes, unreviewed data and invalid release URLs',async()=>{
  let input=releaseInput();input.entries.pop();await assert.rejects(assembleRelease(input),/揃って/);
  input=releaseInput();input.entries[0].project.lessons[0].reviewed=false;await assert.rejects(assembleRelease(input),/未確認/);
  input=releaseInput();input.releaseBaseUrl='https://example.com/releases/download/2026.S.0/';await assert.rejects(assembleRelease(input),/URL/);
});
test('detects corruption, extra assets and mismatched class set',async()=>{
  const {manifest,files}=await assembleRelease(releaseInput());files.set('1-1.sktjf.json',Buffer.from('{}'));files.set('unexpected.json',Buffer.from('{}'));
  const errors=validateRelease(manifest,files,['1-1','1-3']).join('\n');assert.match(errors,/SHA-256/);assert.match(errors,/manifestにない/);assert.match(errors,/対象クラス/);
});
test('rejects false manifest metadata and off-release asset URLs',async()=>{
  const {manifest,files}=await assembleRelease(releaseInput());manifest.assets[0].url='https://github.com/example/SKTJF/releases/download/2026.S.1/1-1.sktjf.json';manifest.revision='2026.F.0';
  const errors=validateRelease(manifest,files).join('\n');assert.match(errors,/URL/);assert.match(errors,/年度・学期/);
});
test('candidate manifests do not invent publication time',async()=>{const input=releaseInput();input.publishedAt=null;const {manifest,files}=await assembleRelease(input);assert.equal(manifest.publishedAt,null);assert.deepEqual(validateRelease(manifest,files),[]);assert.match(validateRelease(manifest,files,undefined,true).join('\n'),/公開日時/);});
