import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSubjectName, subjectIdentityKey } from '../web/subject-names.js';
import { extractPage } from '../web/extract.js';
import { buildDistribution } from '../lib/export.js';
import { parseSktjf, serializeSktjf, validateSktjf } from '../lib/validator.js';
import { fixture } from './support/synthetic.js';

test('combined health and physical education spellings use 保体 with canonical numerals', () => {
  for (const [input, expected] of [
    ['保健・体育', '保体'], ['保健･体育', '保体'], ['保健体育', '保体'],
    ['保健・体育Ⅰ', '保体I'], ['保健・体育II', '保体II'], ['保健･体育３', '保体III'],
    ['保健体育IV', '保体IV'], ['保体５', '保体V'], ['保健・体育X', '保体X'],
    ['保健体育Ⅱ（選択）', '保体II（選択）'], ['数学Ⅳ', '数学IV'],
  ]) assert.equal(normalizeSubjectName(input), expected, input);
});

test('normalization does not combine standalone subjects or split course names', () => {
  for (const name of ['保健', '体育', '保健／体育']) {
    assert.equal(normalizeSubjectName(name), name);
  }
  assert.notEqual(subjectIdentityKey('保健'), subjectIdentityKey('体育'));
});

test('identity comparison equates roman numeral spellings without equating different courses', () => {
  assert.equal(subjectIdentityKey('保健・体育II'), subjectIdentityKey('保体Ⅱ'));
  assert.equal(subjectIdentityKey('保体I'), subjectIdentityKey('保健体育１'));
  assert.notEqual(subjectIdentityKey('保体I'), subjectIdentityKey('保体II'));
});

test('PDF extraction normalizes the editable subject and preserves extracted source text', () => {
  const item=(str,x,y)=>({str,transform:[1,0,0,1,x,y]});
  const items=[
    ...[800,780,760,740].flatMap((y,index)=>[item(String(index+1),5,y),item('組',10,y)]),
    ...Array.from({length:20},(_,i)=>item(`${i+1}校時`,150+i*40,820)),
    ...Array.from({length:16},(_,i)=>item(['機械','電気・電子','情報','化学・生物'][i%4],110,700-i*22)),
    item('保健・体育 1',140,690),
  ];
  const result=extractPage(items,1190,842,2026,'S',1);
  const lesson=result.lessons.find(cell=>cell.classId==='2M'&&cell.day===1&&cell.period===1);
  assert.equal(lesson.entries[0].subject,'保体I');
  assert.equal(lesson.raw,'保健・体育 1');
});

test('SKTJF generation and JSON round-trip canonicalize subjects while preserving source project text', async () => {
  const {project,options}=fixture();
  const entry=project.lessons[0].entries[0];
  entry.subject='保健･体育2';
  project.lessons[0].raw='保健･体育2 原文';
  const output=await buildDistribution(project,options);
  assert.equal(output.lessons[0].subject,'保体II');
  assert.equal(project.lessons[0].entries[0].subject,'保健･体育2');
  assert.equal(project.lessons[0].raw,'保健･体育2 原文');
  assert.deepEqual(validateSktjf(output),[]);

  const legacy={...output,lessons:output.lessons.map(lesson=>({...lesson,subject:'保健体育II'}))};
  assert.ok(validateSktjf(legacy,{allowLegacySubjectAliases:false}).some(message=>message.includes('保体')));
  assert.deepEqual(validateSktjf(legacy),[]);
  assert.equal(parseSktjf(JSON.stringify(legacy)).lessons[0].subject,'保健体育II');
  assert.equal(JSON.parse(serializeSktjf(legacy)).lessons[0].subject,'保体II');
});
