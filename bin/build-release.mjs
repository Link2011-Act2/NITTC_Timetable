import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { assembleRelease } from '../lib/release.js';
import { assembleReleaseV2 } from '../lib/release-v2.js';

if(process.argv.length!==4){console.error('Usage: node bin/build-release.mjs CONFIG.json NEW_OUTPUT_DIRECTORY');process.exitCode=2;}
else try {
  const configPath=resolve(process.argv[2]),config=JSON.parse(await readFile(configPath,'utf8'));
  if(!Array.isArray(config.entries))throw new Error('entries is required');
  const version=config.dataFormatVersion??1;if(![1,2].includes(version))throw new Error('dataFormatVersion is invalid');
  const entries=[];
  for(const entry of config.entries){
    if(version===2&&entry.approvedV1Path!==undefined){
      if(typeof entry.approvedV1Path!=='string'||typeof entry.sha256!=='string')throw new Error('approvedV1Path and sha256 are required');
      entries.push({approvedV1:{bytes:await readFile(resolve(dirname(configPath),entry.approvedV1Path)),sha256:entry.sha256}});
    }else{
      if(typeof entry.projectPath!=='string')throw new Error('projectPath is required');
      const project=JSON.parse(await readFile(resolve(dirname(configPath),entry.projectPath),'utf8'));
      entries.push({project,options:entry.options,...(version===2&&entry.weekDays!==undefined?{weekDays:entry.weekDays}:{})});
    }
  }
  if(version===2&&config.vacationsPath!==undefined)throw new Error('長期休業は別の配信として作成してください');
  const vacations=config.vacationsPath===undefined?undefined:JSON.parse(await readFile(resolve(dirname(configPath),config.vacationsPath),'utf8'));
  const {manifest,files}=version===2?await assembleReleaseV2({...config,entries}):await assembleRelease({...config,entries,vacations});
  const output=resolve(process.argv[3]);
  // An existing directory is never replaced; the manifest is written last.
  await mkdir(output);
  for(const [name,bytes] of files)await writeFile(resolve(output,name),bytes,{flag:'wx'});
  await writeFile(resolve(output,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`,{encoding:'utf8',flag:'wx'});
  console.log(`Created ${files.size} data assets and manifest`);
} catch(error){console.error(error.message);process.exitCode=1;}
