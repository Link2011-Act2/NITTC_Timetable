import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {parseStrictJson} from './strict-json.js';
import {validateRelease} from './release.js';
import {validateSktjfV2} from './validator-v2.js';
import {validateSktjfV3} from './validator-v3.js';
import {buildDistributionV2} from './export-v2.js';
import {buildDistributionV3} from './export-v3.js';
import {parseSktjf} from './validator.js';
import {revisionMatches} from './revision.js';
import {classIds} from '../web/table-model.js';
import {normalizeSktjfSubjectNames} from '../web/subject-names.js';
import {buildVacationAssets} from './vacations.js';

const ajv=new Ajv2020({allErrors:true,strict:true});addFormats(ajv);
const shape=ajv.compile(JSON.parse(readFileSync(new URL('../schema/manifest-v3.schema.json',import.meta.url),'utf8')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function assembleReleaseV3({academicYear,term,revision,publishedAt,releaseBaseUrl,expectedClasses,entries,vacations}){
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
      const hasGroups=(entry.project.selectionGroups||[]).some(group=>group.term===term&&group.classId===entry.options.classId);
      document=hasGroups?await buildDistributionV3(entry.project,entry.options,entry.weekDays):await buildDistributionV2(entry.project,entry.options,entry.weekDays);
    }
    if(!expectedClasses.includes(document.classId)||byClass.has(document.classId))throw new Error('対象クラスが重複または不足しています');
    byClass.set(document.classId,Buffer.from(JSON.stringify(document,null,2)+'\n','utf8'));
  }
  const files=new Map(),assets=expectedClasses.slice().sort().map(id=>{
    const bytes=byClass.get(id);if(!bytes)throw new Error(`${id}: データがありません`);
    const name=`${id}.sktjf.json`;files.set(name,bytes);
    return {classId:id,name,url:`${releaseBaseUrl}${name}`,sha256:sha(bytes),dataFormatVersion:parseStrictJson(bytes,4*1024*1024).schemaVersion};
  });
  const manifest={format:'SKTJF-MANIFEST',manifestVersion:1,schoolId:'nittc',academicYear,term,revision,publishedAt:publishedAt??null,dataFormatVersion:3,classIds:expectedClasses.slice().sort(),assets};
  if(vacations!==undefined)for(const [name,bytes] of buildVacationAssets(vacations,revision,releaseBaseUrl))files.set(name,bytes);
  const errors=validateReleaseV3(manifest,files,expectedClasses);if(errors.length)throw new Error(errors.join('\n'));
  return {manifest,files};
}
export function validateReleaseV3(manifest,files,expectedClasses,requirePublished=false){
  if(!shape(manifest))return shape.errors.map(e=>`${e.instancePath||'/'} ${e.message}`);
  if(!(files instanceof Map))return ['ファイル一覧が正しくありません'];
  const errors=[],legacy=structuredClone(manifest),legacyFiles=new Map(files);legacy.dataFormatVersion=1;
  for(const asset of legacy.assets){
    const original=manifest.assets.find(item=>item.classId===asset.classId&&item.name===asset.name),bytes=files.get(asset.name);
    if(!Buffer.isBuffer(bytes)){errors.push(`${asset.name}: ファイルがありません`);asset.dataFormatVersion=1;continue;}
    if(sha(bytes)!==original.sha256)errors.push(`${asset.name}: SHA-256が一致しません`);
    try{
      const doc=parseStrictJson(bytes,4*1024*1024);
      if(doc.schemaVersion!==original.dataFormatVersion)throw Error('形式バージョンが一致しません');
      if(original.dataFormatVersion>1){
        const issues=original.dataFormatVersion===3?validateSktjfV3(doc):validateSktjfV2(doc);
        if(issues.length)throw Error(issues.join('\n'));
        doc.schemaVersion=1;delete doc.weekCalendar;delete doc.weekSeries;delete doc.selectionGroups;
        for(const lesson of doc.lessons)delete lesson.activeWeekRange;
        const converted=Buffer.from(JSON.stringify(doc),'utf8');legacyFiles.set(asset.name,converted);asset.sha256=sha(converted);
      }
    }catch(error){errors.push(`${asset.name}: ${error.message}`);}
    asset.dataFormatVersion=1;
  }
  return [...errors,...validateRelease(legacy,legacyFiles,expectedClasses,requirePublished)];
}
