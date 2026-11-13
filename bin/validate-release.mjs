import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateRelease } from '../lib/release.js';

if(process.argv.length<3){console.error('Usage: node bin/validate-release.mjs DIRECTORY [--published] [CLASS...]');process.exitCode=2;}
else try {
  const flags=process.argv.slice(3),requirePublished=flags.includes('--published'),classes=flags.filter(x=>x!=='--published');
  if(flags.some(x=>x.startsWith('--')&&x!=='--published'))throw new Error('オプションが正しくありません');
  const root=resolve(process.argv[2]),items=await readdir(root,{withFileTypes:true});
  if(items.some(item=>!item.isFile()||!(/^(manifest\.json|[A-Za-z0-9-]+\.sktjf\.json)$/.test(item.name))))throw new Error('配信対象外のファイルがあります');
  const manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8')),files=new Map();
  for(const item of items)if(item.name!=='manifest.json')files.set(item.name,await readFile(resolve(root,item.name)));
  const errors=validateRelease(manifest,files,classes.length?classes:undefined,requirePublished);if(errors.length)throw new Error(errors.join('\n'));
  console.log(`Valid: ${files.size} class assets`);
}catch(error){console.error(error.message);process.exitCode=1;}
