import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
test('rejects a manifest pointing classes at different repositories or noncanonical URLs',async()=>{
  let {manifest,files}=await assembleRelease(releaseInput());
  manifest.assets[1].url=manifest.assets[1].url.replace('/example/','/other/');
  assert.match(validateRelease(manifest,files).join('\n'),/配信元が一致しません/);
  ({manifest,files}=await assembleRelease(releaseInput()));
  manifest.assets[0].url=manifest.assets[0].url.replace('github.com/','github.com:443/');
  assert.ok(validateRelease(manifest,files).length);
});
test('release assembly rejects values too long for the Android consumer',async()=>{
  const input=releaseInput();input.entries[0].project.lessons[0].entries[0].subject='x'.repeat(1001);
  await assert.rejects(assembleRelease(input),/授業の内容/);
});
test('candidate manifests do not invent publication time',async()=>{const input=releaseInput();input.publishedAt=null;const {manifest,files}=await assembleRelease(input);assert.equal(manifest.publishedAt,null);assert.deepEqual(validateRelease(manifest,files),[]);assert.match(validateRelease(manifest,files,undefined,true).join('\n'),/公開日時/);});
test('release validation rejects missing slots and dates even when the asset hash matches',async()=>{
  const {manifest,files}=await assembleRelease(releaseInput()),name='1-1.sktjf.json';
  const data=JSON.parse(files.get(name).toString('utf8'));data.slotCoverage.pop();data.calendar.pop();
  const bytes=Buffer.from(JSON.stringify(data));files.set(name,bytes);
  manifest.assets.find(asset=>asset.name===name).sha256=createHash('sha256').update(bytes).digest('hex');
  const errors=validateRelease(manifest,files).join('\n');
  assert.match(errors,/枠がありません/);assert.match(errors,/日付がありません/);assert.doesNotMatch(errors,/SHA-256/);
});
test('release validation rejects duplicate keys and invalid UTF-8 even with a matching hash',async()=>{
  for(const corrupt of [
    bytes=>Buffer.from(bytes.toString('utf8').replace('"classId": "1-1"',String.raw`"classId": "2M", "class\u0049d": "1-1"`)),
    bytes=>{const result=Buffer.from(bytes),index=result.indexOf(Buffer.from('数学'));assert.ok(index>=0);result[index]=0xff;return result;}
  ]){
    const {manifest,files}=await assembleRelease(releaseInput()),name='1-1.sktjf.json',bytes=corrupt(files.get(name));
    files.set(name,bytes);manifest.assets.find(asset=>asset.name===name).sha256=createHash('sha256').update(bytes).digest('hex');
    const errors=validateRelease(manifest,files).join('\n');assert.match(errors,/重複|文字コード/);assert.doesNotMatch(errors,/SHA-256/);
  }
});
