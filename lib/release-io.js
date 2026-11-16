import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseStrictJson} from './strict-json.js';

/** Read only the exact release asset set; extra files and directories are errors. */
export async function readReleaseDirectory(root) {
  const items=await readdir(root,{withFileTypes:true});
  if(items.some(item=>!item.isFile()||!(/^(manifest\.json|[A-Za-z0-9-]+\.sktjf\.json)$/.test(item.name))))throw new Error('配信対象外のファイルがあります');
  const manifest=parseStrictJson(await readFile(resolve(root,'manifest.json')),512*1024),files=new Map();
  for(const item of items)if(item.name!=='manifest.json')files.set(item.name,await readFile(resolve(root,item.name)));
  return {manifest,files};
}
