import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createAppServer } from '../server.mjs';

const cli = fileURLToPath(new URL('../bin/vacation-release.mjs', import.meta.url));
const run = promisify(execFile);
const repository = 'example/SKTJF';
const source = {name:'synthetic-calendar.pdf', url:null, sha256:'a'.repeat(64), page:1};

test('Web review validates each item before the CLI accepts a standalone release and its next-year correction', async t => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const ui = await fetch(`${origin}/web/vacation-review.html`);
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /確認済みの最終日/);
  const period = {id:'2026-year_end', type:'year_end', name:'学年末休業', start:'2027-02-20', end:null,
    confirmedThrough:null, estimatedEndMonth:4, sources:[source], raw:'休業の原文', reviewed:false};
  const draft = {periods:[period], periodEvidence:[{id:period.id, arrowThroughCandidate:'2027-03-31'}]};
  const review = async (requestOrigin = origin) => fetch(`${origin}/api/review-vacation`, {method:'POST',
    headers:{Origin:requestOrigin, 'Content-Type':'application/json'}, body:JSON.stringify({draft, id:period.id})});
  assert.equal((await review()).status, 400);
  period.confirmedThrough = '2027-03-31';
  assert.equal((await review('https://example.org')).status, 404);
  assert.equal((await review()).status, 200);

  const dir = await mkdtemp(join(tmpdir(), 'sktjf-vacation-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const input = join(dir, 'review.json');
  const first = join(dir, 'first'), later = join(dir, 'later');
  const build = (revision, output) => run(process.execPath, [cli, 'build', revision, repository, input, output]);
  const validate = (revision, output) => run(process.execPath, [cli, 'validate', revision, repository, output]);
  await writeFile(input, JSON.stringify(draft));
  await assert.rejects(build('2026.F.0.Beta', first), /未確認/);
  period.reviewed = true;
  await writeFile(input, JSON.stringify(draft));
  await build('2026.F.0.Beta', first);
  await validate('2026.F.0.Beta', first);
  assert.deepEqual((await readdir(first)).sort(), ['vacations.json', 'vacations.manifest.json']);
  const manifest = JSON.parse(await readFile(join(first, 'vacations.manifest.json'), 'utf8'));
  assert.equal(manifest.asset.url, 'https://github.com/example/SKTJF/releases/download/vacations-2026.F.0.Beta/vacations.json');
  const initial = JSON.parse(await readFile(join(first, 'vacations.json'), 'utf8')).periods[0];
  assert.equal(initial.end, null);
  assert.equal(initial.raw, undefined);
  assert.deepEqual(initial.sources, [source]);

  Object.assign(period, {end:'2027-04-05', confirmedThrough:'2027-04-05', estimatedEndMonth:null, reviewed:false,
    sources:[source, {...source, name:'synthetic-next-calendar.pdf', sha256:'b'.repeat(64)}]});
  assert.equal((await review()).status, 200);
  period.reviewed = true;
  await writeFile(input, JSON.stringify(draft));
  await build('2027.S.0.Beta', later);
  await validate('2027.S.0.Beta', later);
  const correction = JSON.parse(await readFile(join(later, 'vacations.json'), 'utf8')).periods[0];
  assert.equal(correction.id, initial.id);
  assert.equal(correction.end, '2027-04-05');
  assert.equal(correction.sources.length, 2);
  await writeFile(join(later, 'vacations.json'), '{}');
  await assert.rejects(validate('2027.S.0.Beta', later), /SHA-256/);
});
