import { resolve } from 'node:path';
import { validateRelease } from '../lib/release.js';
import { validateReleaseV2 } from '../lib/release-v2.js';
import { readReleaseDirectory } from '../lib/release-io.js';

if(process.argv.length<3){console.error('Usage: node bin/validate-release.mjs DIRECTORY [--published] [CLASS...]');process.exitCode=2;}
else try {
  const flags=process.argv.slice(3),requirePublished=flags.includes('--published'),classes=flags.filter(x=>x!=='--published');
  if(flags.some(x=>x.startsWith('--')&&x!=='--published'))throw new Error('オプションが正しくありません');
  const root=resolve(process.argv[2]),{manifest,files}=await readReleaseDirectory(root);
  const validate=manifest.dataFormatVersion===2?validateReleaseV2:validateRelease;
  const errors=validate(manifest,files,classes.length?classes:undefined,requirePublished);if(errors.length)throw new Error(errors.join('\n'));
  console.log(`Valid: ${files.size} class assets`);
}catch(error){console.error(error.message);process.exitCode=1;}
