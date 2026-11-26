import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture } from './support/synthetic.js';
import { buildDistribution } from '../lib/export.js';
import { createHash } from 'node:crypto';
import { putSelectionGroup } from '../web/table-model.js';

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
  const finalManifest=join(root,'published-manifest.json'),timestamp='2026-04-02T12:34:56Z';
  const finalize=(dir,time,target,...classes)=>run('bin/finalize-manifest.mjs',dir,time,target,...classes);
  const completed=finalize(output,timestamp,finalManifest,'1-1');assert.equal(completed.status,0,completed.stderr);
  const finalized=JSON.parse(await readFile(finalManifest,'utf8')),candidate=JSON.parse(before);
  assert.deepEqual({...finalized,publishedAt:null},candidate);assert.equal(finalized.publishedAt,timestamp);
  const finalDir=join(root,'final');await mkdir(finalDir);
  await writeFile(join(finalDir,'manifest.json'),await readFile(finalManifest));
  await writeFile(join(finalDir,'1-1.sktjf.json'),await readFile(join(output,'1-1.sktjf.json')));
  assert.equal(run('bin/validate-release.mjs',finalDir,'--published','1-1').status,0);
  assert.notEqual(finalize(output,timestamp,finalManifest,'1-1').status,0);
  assert.notEqual(finalize(output,timestamp,join(output,'published.json'),'1-1').status,0);
  assert.notEqual(finalize(output,'not-a-date',join(root,'invalid.json'),'1-1').status,0);
  assert.notEqual(finalize(output,timestamp,join(root,'wrong-class.json'),'1-2').status,0);
  assert.deepEqual(await readFile(join(output,'manifest.json')),before);
  assert.notEqual(run('bin/build-release.mjs',join(root,'config.json'),output).status,0);assert.deepEqual(await readFile(join(output,'manifest.json')),before);
  const duplicate=before.toString('utf8').replace('"manifestVersion": 1','"manifestVersion": 2, "manifestVersion": 1');
  await writeFile(join(output,'manifest.json'),duplicate);
  const rejected=run('bin/validate-release.mjs',output,'1-1');assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/重複/);
  assert.notEqual(finalize(output,timestamp,join(root,'tampered.json'),'1-1').status,0);
});

test('v3 release CLI retains explicit selection groups',async t=>{
  const parent=resolve(tmpdir()),root=await mkdtemp(join(parent,'sktjf-v3-test-'));const rel=relative(parent,root);
  if(!rel||rel==='..'||rel.startsWith(`..${sep}`)||resolve(parent,rel)!==root)throw new Error('unsafe temporary path');
  t.after(()=>rm(root,{recursive:true,force:true}));
  const {project,options}=fixture();project.lessons[0].entries.push({...project.lessons[0].entries[0],id:'alternative',subject:'選択授業'});
  putSelectionGroup(project,{term:'S',classId:'1-1',day:1,period:1,lessonIds:['stable-id','alternative'],id:'group'}).reviewed=true;
  const vacation={id:'2026-year_end',type:'year_end',name:'学年末休業',start:'2027-02-20',end:null,confirmedThrough:'2027-03-31',
    estimatedEndMonth:4,reviewed:true,sources:[{name:'calendar.pdf',url:null,sha256:'a'.repeat(64),page:1}]};
  const config={dataFormatVersion:3,academicYear:2026,term:'S',revision:'2026.S.0',publishedAt:null,vacationsPath:'vacations.json',
    releaseBaseUrl:'https://github.com/example/SKTJF/releases/download/2026.S.0/',expectedClasses:['1-1'],entries:[{projectPath:'project.json',options,weekDays:[]}]};
  await writeFile(join(root,'vacations.json'),JSON.stringify({periods:[vacation]}));
  await writeFile(join(root,'project.json'),JSON.stringify(project));await writeFile(join(root,'config.json'),JSON.stringify(config));
  const output=join(root,'release'),run=(...args)=>spawnSync(process.execPath,args,{encoding:'utf8'});
  const built=run('bin/build-release.mjs',join(root,'config.json'),output);assert.equal(built.status,0,built.stderr);
  const validated=run('bin/validate-release.mjs',output,'1-1');assert.equal(validated.status,0,validated.stderr);
  assert.equal(JSON.parse(await readFile(join(output,'1-1.sktjf.json'),'utf8')).selectionGroups[0].id,'group');
  assert.equal(JSON.parse(await readFile(join(output,'vacations.json'),'utf8')).periods[0].end,null);
  assert.equal(JSON.parse(await readFile(join(output,'vacations.manifest.json'),'utf8')).revision,config.revision);
  const finalized=run('bin/finalize-manifest.mjs',output,'2026-04-02T12:34:56Z',join(root,'published.json'),'1-1');
  assert.equal(finalized.status,0,finalized.stderr);
  await writeFile(join(output,'vacations.json'),'{}');
  assert.match(run('bin/validate-release.mjs',output,'1-1').stderr,/SHA-256/);
  const teachingDate=project.calendar.find(cell=>cell.dayType==='A'||cell.dayType==='B').date;
  const conflict={...vacation,id:'2026-spring',type:'spring',name:'春季休業',start:teachingDate,end:teachingDate,
    confirmedThrough:teachingDate,estimatedEndMonth:null};
  await writeFile(join(root,'vacations.json'),JSON.stringify({periods:[conflict]}));
  assert.match(run('bin/build-release.mjs',join(root,'config.json'),join(root,'conflict')).stderr,/授業日が重なっています/);
  vacation.reviewed=false;await writeFile(join(root,'vacations.json'),JSON.stringify({periods:[vacation]}));
  assert.match(run('bin/build-release.mjs',join(root,'config.json'),join(root,'unapproved')).stderr,/未確認/);
});

test('mixed release CLI preserves approved v1 and validates a counted v2 asset',async t=>{
  const parent=resolve(tmpdir()),root=await mkdtemp(join(parent,'sktjf-v2-test-'));const rel=relative(parent,root);
  if(!rel||rel==='..'||rel.startsWith(`..${sep}`)||resolve(parent,rel)!==root)throw new Error('unsafe temporary path');
  t.after(()=>rm(root,{recursive:true,force:true}));
  const {project,options}=fixture(),original=await buildDistribution(project,options),bytes=Buffer.from(JSON.stringify(original));
  const second=structuredClone(project);for(const cell of second.lessons)cell.classId='2M';
  const entry=second.lessons[0].entries[0];Object.assign(entry,{subject:'卒研',weekStart:'1',weekEnd:'',weekSourceNotation:'（1週〜）'});
  second.weekSeries=[{term:'S',classId:'2M',id:'shared',dayOfWeek:1,periods:[1],lessonIds:[entry.id],cycle:'WEEKLY',reviewed:true,
    sources:[{sourceId:'src',page:1}],countingPolicy:{regularDayCounts:true,holidayCounts:false,eventCounts:{},ordinaryPeriodCounts:true,
      officialPeriodOverrides:[],confirmedNonTeachingDates:[],sources:[{sourceId:'src',page:1}]}}];
  const revision='2026.S.1.Beta',config={dataFormatVersion:2,academicYear:2026,term:'S',revision,publishedAt:null,
    releaseBaseUrl:`https://github.com/example/SKTJF/releases/download/${revision}/`,expectedClasses:['1-1','2M'],entries:[
      {approvedV1Path:'approved.json',sha256:createHash('sha256').update(bytes).digest('hex')},
      {projectPath:'project.json',options:{...options,classId:'2M',revision},weekDays:[]} ]};
  config.vacationsPath='vacations.json';
  await writeFile(join(root,'vacations.json'),JSON.stringify({periods:[{id:'2026-year_end',type:'year_end',name:'学年末休業',
    start:'2027-02-20',end:null,confirmedThrough:'2027-03-31',estimatedEndMonth:4,reviewed:true,
    sources:[{name:'calendar.pdf',url:null,sha256:'a'.repeat(64),page:1}]}]}));
  await writeFile(join(root,'approved.json'),bytes);await writeFile(join(root,'project.json'),JSON.stringify(second));
  await writeFile(join(root,'config.json'),JSON.stringify(config));const output=join(root,'release');
  const run=(...args)=>spawnSync(process.execPath,args,{encoding:'utf8'});
  const built=run('bin/build-release.mjs',join(root,'config.json'),output);assert.equal(built.status,0,built.stderr);
  const validated=run('bin/validate-release.mjs',output,'1-1','2M');assert.equal(validated.status,0,validated.stderr);
  assert.equal(JSON.parse(await readFile(join(output,'vacations.json'),'utf8')).revision,revision);
  const first=JSON.parse(await readFile(join(output,'1-1.sktjf.json'),'utf8'));
  assert.deepEqual({...first,revision:original.revision},original);
  const secondAsset=JSON.parse(await readFile(join(output,'2M.sktjf.json'),'utf8'));
  assert.equal(secondAsset.weekSeries[0].countingPolicy.regularDayCounts,true);
  const final=join(root,'published.json'),finalized=run('bin/finalize-manifest.mjs',output,'2026-04-02T12:34:56Z',final,'1-1','2M');
  assert.equal(finalized.status,0,finalized.stderr);
  const changed=JSON.parse(JSON.stringify(second));changed.weekSeries[0].countingPolicy.officialPeriodOverrides=[{date:'2026-04-06',period:1,counts:null}];
  await writeFile(join(root,'project.json'),JSON.stringify(changed));
  const unsafe=run('bin/build-release.mjs',join(root,'config.json'),join(root,'blocked'));
  assert.notEqual(unsafe.status,0);assert.match(unsafe.stderr,/授業機会が未確認/);
});
