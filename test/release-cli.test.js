import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture } from './support/synthetic.js';

test('release CLI writes a validated candidate once and never replaces it',async t=>{
  const parent=resolve(tmpdir()),root=await mkdtemp(join(parent,'sktjf-test-'));const rel=relative(parent,root);
  if(!rel||rel==='..'||rel.startsWith(`..${sep}`)||resolve(parent,rel)!==root)throw new Error('unsafe temporary path');
  t.after(()=>rm(root,{recursive:true,force:true}));
  const {project,options}=fixture(),config={academicYear:2026,term:'S',revision:'2026.S.0',publishedAt:null,releaseBaseUrl:'https://github.com/example/SKTJF/releases/download/2026.S.0/',expectedClasses:['1-1'],entries:[{projectPath:'project.json',options}]};
  await writeFile(join(root,'project.json'),JSON.stringify(project));await writeFile(join(root,'config.json'),JSON.stringify(config));const output=join(root,'release');
  const run=(...args)=>spawnSync(process.execPath,args,{encoding:'utf8'});
  const built=run('bin/build-release.mjs',join(root,'config.json'),output);assert.equal(built.status,0,built.stderr);
  const before=await readFile(join(output,'manifest.json'));assert.equal(run('bin/validate-release.mjs',output,'1-1').status,0);
  assert.notEqual(run('bin/validate-release.mjs',output,'--published').status,0);
  assert.notEqual(run('bin/build-release.mjs',join(root,'config.json'),output).status,0);assert.deepEqual(await readFile(join(output,'manifest.json')),before);
});
