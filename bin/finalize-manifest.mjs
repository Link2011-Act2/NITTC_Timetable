import {realpath,writeFile} from 'node:fs/promises';
import {basename,dirname,relative,resolve,isAbsolute,sep} from 'node:path';
import {readReleaseDirectory} from '../lib/release-io.js';
import {validateRelease} from '../lib/release.js';
import {validateReleaseV2} from '../lib/release-v2.js';

if(process.argv.length<6){console.error('Usage: node bin/finalize-manifest.mjs CANDIDATE_DIRECTORY PUBLISHED_AT NEW_FILE CLASS...');process.exitCode=2;}
else try{
  const candidate=await realpath(resolve(process.argv[2])),publishedAt=process.argv[3];
  const output=resolve(await realpath(dirname(resolve(process.argv[4]))),basename(process.argv[4]));
  const inside=relative(candidate,output);
  if(!inside||(!isAbsolute(inside)&&inside!=='..'&&!inside.startsWith(`..${sep}`)))throw new Error('候補とは別の場所を指定してください');
  const classes=process.argv.slice(5),{manifest,files}=await readReleaseDirectory(candidate);
  if(manifest.publishedAt!==null)throw new Error('公開日時が設定済みです');
  const validate=manifest.dataFormatVersion===2?validateReleaseV2:validateRelease;
  const before=validate(manifest,files,classes);
  if(before.length)throw new Error(before.join('\n'));
  const result={...manifest,publishedAt},after=validate(result,files,classes,true);
  if(after.length)throw new Error(after.join('\n'));
  await writeFile(output,`${JSON.stringify(result,null,2)}\n`,{encoding:'utf8',flag:'wx'});
  console.log('公開用 manifest を作成しました');
}catch(error){console.error(error.message);process.exitCode=1;}
