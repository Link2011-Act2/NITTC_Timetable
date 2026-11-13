import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { assembleRelease } from '../lib/release.js';

if(process.argv.length!==4){console.error('Usage: node bin/build-release.mjs CONFIG.json NEW_OUTPUT_DIRECTORY');process.exitCode=2;}
else try {
  const configPath=resolve(process.argv[2]),config=JSON.parse(await readFile(configPath,'utf8'));
  if(!Array.isArray(config.entries))throw new Error('entries is required');
  const entries=[];
  for(const entry of config.entries){if(typeof entry.projectPath!=='string')throw new Error('projectPath is required');const project=JSON.parse(await readFile(resolve(dirname(configPath),entry.projectPath),'utf8'));entries.push({project,options:entry.options});}
  const {manifest,files}=await assembleRelease({...config,entries});
  const output=resolve(process.argv[3]);
  // An existing directory is never replaced; the manifest is written last.
  await mkdir(output);
  for(const [name,bytes] of files)await writeFile(resolve(output,name),bytes,{flag:'wx'});
  await writeFile(resolve(output,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`,{encoding:'utf8',flag:'wx'});
  console.log(`Created ${files.size} class assets and manifest`);
} catch(error){console.error(error.message);process.exitCode=1;}
