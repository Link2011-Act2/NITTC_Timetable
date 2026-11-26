import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {parseStrictJson} from './strict-json.js';
import {validateRelease} from './release.js';
import {validateSktjfV2} from './validator-v2.js';
import {buildDistributionV2} from './export-v2.js';
import {parseSktjf} from './validator.js';
import {revisionMatches} from './revision.js';
import {classIds} from '../web/table-model.js';
import {normalizeSktjfSubjectNames} from '../web/subject-names.js';
import {buildVacationAssets} from './vacations.js';

const schema=JSON.parse(readFileSync(new URL('../schema/manifest-v2.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({allErrors:true,strict:true});addFormats(ajv);const shape=ajv.compile(schema);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Assemble and validate an in-memory mixed-version release candidate. */
export async function assembleReleaseV2({academicYear,term,revision,publishedAt,releaseBaseUrl,expectedClasses,entries,vacations}){
  if(!revisionMatches(revision,academicYear,term))throw new Error('配信の年度・学期・改訂番号が正しくありません');
  if(!Array.isArray(expectedClasses)||!expectedClasses.length||new Set(expectedClasses).size!==expectedClasses.length||expectedClasses.some(id=>!classIds.includes(id)))throw new Error('対象クラスが正しくありません');
  if(!Array.isArray(entries)||entries.length!==expectedClasses.length)throw new Error('対象クラスのデータが揃っていません');
  const byClass=new Map();
  for(const entry of entries){
    let document;
    if(entry?.approvedV1){
      const {bytes,sha256}=entry.approvedV1;
      if(!Buffer.isBuffer(bytes)||!/^([a-f0-9]{64})$/.test(sha256||'')||sha(bytes)!==sha256)throw new Error('既存の承認済みデータのSHA-256を確認してください');
      const old=parseSktjf(bytes);
      if(!/^1-[1-4]$/.test(old.classId)||old.academicYear!==academicYear||old.term.code!==term)throw new Error('既存の1年生データを確認してください');
      document=normalizeSktjfSubjectNames({...old,revision});
    }else{
      if(entry?.project?.year!==academicYear||entry.options?.term!==term||entry.options?.revision!==revision)throw new Error('年度・学期・改訂番号が一致しません');
      document=await buildDistributionV2(entry.project,entry.options,entry.weekDays);
    }
    if(!expectedClasses.includes(document.classId)||byClass.has(document.classId))throw new Error('対象クラスが重複または不足しています');
    byClass.set(document.classId,Buffer.from(JSON.stringify(document,null,2)+'\n','utf8'));
  }
  const files=new Map(),assets=expectedClasses.slice().sort().map(id=>{
    const bytes=byClass.get(id);if(!bytes)throw new Error(`${id}: データがありません`);
    const name=`${id}.sktjf.json`;files.set(name,bytes);
    return {classId:id,name,url:`${releaseBaseUrl}${name}`,sha256:sha(bytes),dataFormatVersion:parseStrictJson(bytes,4*1024*1024).schemaVersion};
  });
  const manifest={format:'SKTJF-MANIFEST',manifestVersion:1,schoolId:'nittc',academicYear,term,revision,publishedAt:publishedAt??null,dataFormatVersion:2,classIds:expectedClasses.slice().sort(),assets};
  if(vacations!==undefined)for(const [name,bytes] of buildVacationAssets(vacations,revision,releaseBaseUrl))files.set(name,bytes);
  const errors=validateReleaseV2(manifest,files,expectedClasses);
  if(errors.length)throw new Error(errors.join('\n'));
  return {manifest,files};
}

/** Validate a mixed-version candidate without treating it as a v1 release. */
export function validateReleaseV2(manifest,files,expectedClasses,requirePublished=false){
  if(!shape(manifest))return shape.errors.map(e=>`${e.instancePath||'/'} ${e.message}`);
  if(!(files instanceof Map))return ['ファイル一覧が正しくありません'];
  const errors=[],legacy=structuredClone(manifest),legacyFiles=new Map(files);
  legacy.dataFormatVersion=1;
  for(const asset of legacy.assets){
    const original=manifest.assets.find(item=>item.classId===asset.classId&&item.name===asset.name);
    const bytes=files.get(asset.name);
    if(!Buffer.isBuffer(bytes)){errors.push(`${asset.name}: ファイルがありません`);asset.dataFormatVersion=1;continue;}
    if(sha(bytes)!==original.sha256)errors.push(`${asset.name}: SHA-256が一致しません`);
    try{
      const document=parseStrictJson(bytes,4*1024*1024);
      if(document.schemaVersion!==original.dataFormatVersion)throw Error('形式バージョンが一致しません');
      if(original.dataFormatVersion===2){
        const issues=validateSktjfV2(document);if(issues.length)throw Error(issues.join('\n'));
        document.schemaVersion=1;delete document.weekCalendar;delete document.weekSeries;
        for(const lesson of document.lessons)delete lesson.activeWeekRange;
        const converted=Buffer.from(JSON.stringify(document),'utf8');legacyFiles.set(asset.name,converted);asset.sha256=sha(converted);
      }
    }catch(error){errors.push(`${asset.name}: ${error.message}`);}
    asset.dataFormatVersion=1;
  }
  return [...errors,...validateRelease(legacy,legacyFiles,expectedClasses,requirePublished)];
}
