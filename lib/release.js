import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buildDistribution } from './export.js';
import { parseSktjf, serializeSktjf } from './validator.js';
import { buildVacationAssets, vacationAssetName, vacationManifestName, verifyVacationAssets } from './vacations.js';
import { revisionMatches } from './revision.js';
import { classIds } from '../web/table-model.js';

const schema=JSON.parse(readFileSync(new URL('../schema/manifest-v1.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv2020({allErrors:true,strict:true});addFormats(ajv);const shape=ajv.compile(schema);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const validClass=id=>classIds.includes(id);

function releaseBase(value,revision){
  let url;try{url=new URL(value);}catch{throw new Error('ReleaseのURLが正しくありません');}
  const expected=new RegExp(`^/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/download/${revision.replaceAll('.','\\.')}/$`);
  if(url.protocol!=='https:'||url.hostname!=='github.com'||url.port||url.username||url.password||url.search||url.hash||!expected.test(url.pathname))throw new Error('ReleaseのURLが正しくありません');
  return url.href;
}

/** Build every asset from reviewed project data; no PDF bytes are included in the result. */
export async function assembleRelease({academicYear,term,revision,publishedAt,releaseBaseUrl,expectedClasses,entries,vacations}) {
  if(!revisionMatches(revision,academicYear,term))throw new Error('配信の年度・学期・改訂番号が正しくありません');
  if(!Array.isArray(expectedClasses)||!expectedClasses.length||expectedClasses.some(c=>typeof c!=='string'||!validClass(c))||new Set(expectedClasses).size!==expectedClasses.length)throw new Error('対象クラスが正しくありません');
  if(!Array.isArray(entries)||entries.length!==expectedClasses.length)throw new Error('対象クラスのデータが揃っていません');
  const base=releaseBase(releaseBaseUrl,revision),byClass=new Map();
  for(const entry of entries){
    const id=entry?.options?.classId;if(!expectedClasses.includes(id)||byClass.has(id))throw new Error('対象クラスが重複または不足しています');
    if(entry.project?.year!==academicYear||entry.options.term!==term||entry.options.revision!==revision)throw new Error(`${id}: 年度・学期・改訂番号が一致しません`);
    const data=await buildDistribution(entry.project,entry.options);byClass.set(id,Buffer.from(serializeSktjf(data),'utf8'));
  }
  const files=new Map();const assets=[...expectedClasses].sort().map(id=>{const name=`${id}.sktjf.json`,bytes=byClass.get(id);if(!bytes)throw new Error(`${id}: データがありません`);files.set(name,bytes);return {classId:id,name,url:new URL(name,base).href,sha256:digest(bytes),dataFormatVersion:1};});
  const manifest={format:'SKTJF-MANIFEST',manifestVersion:1,schoolId:'nittc',academicYear,term,revision,publishedAt:publishedAt??null,dataFormatVersion:1,classIds:[...expectedClasses].sort(),assets};
  if(vacations!==undefined)for(const [name,bytes] of buildVacationAssets(vacations,revision,base))files.set(name,bytes);
  const issues=validateRelease(manifest,files,expectedClasses);if(issues.length)throw new Error(issues.join('\n'));
  return {manifest,files};
}

/** Check manifest, exact asset set, byte digests, URLs and every SKTJF document. */
export function validateRelease(manifest,files,expectedClasses,requirePublished=false) {
  if(!shape(manifest))return shape.errors.map(e=>`${e.instancePath||'/'} ${e.message}`);
  const errors=[],classes=new Set(),names=new Set(),classDocuments=[];let baseUrl;
  if(manifest.classIds.length>128||manifest.assets.length>128)errors.push('manifest: 対象クラスが多すぎます');
  if(manifest.revision.length>1024||(manifest.publishedAt!==null&&manifest.publishedAt.length>64))errors.push('manifest: 文字数が多すぎます');
  if(!revisionMatches(manifest.revision,manifest.academicYear,manifest.term))errors.push('manifest: 年度・学期・改訂番号が一致しません');
  if(manifest.classIds.some(id=>!validClass(id)))errors.push('manifest: 本科のクラスを指定してください');
  if(requirePublished&&manifest.publishedAt===null)errors.push('公開日時がありません');
  if(!(files instanceof Map))return [...errors,'ファイル一覧が正しくありません'];
  for(const asset of manifest.assets){
    if(classes.has(asset.classId)||names.has(asset.name))errors.push(`${asset.classId}: 重複しています`);classes.add(asset.classId);names.add(asset.name);
    if(asset.classId.length>128||asset.name.length>160||asset.url.length>2048)errors.push(`${asset.classId}: 文字数が多すぎます`);
    if(asset.name!==`${asset.classId}.sktjf.json`)errors.push(`${asset.classId}: ファイル名が一致しません`);
    try{const prefix=asset.url.slice(0,asset.url.length-asset.name.length);if(!asset.url.endsWith('/'+asset.name)||releaseBase(prefix,manifest.revision)!==prefix)throw Error();if(baseUrl&&baseUrl!==prefix)errors.push(`${asset.classId}: 配信元が一致しません`);baseUrl??=prefix;}catch{errors.push(`${asset.classId}: URLが正しくありません`);}
    const bytes=files.get(asset.name);if(!Buffer.isBuffer(bytes)){errors.push(`${asset.name}: ファイルがありません`);continue;}
    if(digest(bytes)!==asset.sha256)errors.push(`${asset.name}: SHA-256が一致しません`);
    try{const data=parseSktjf(bytes);classDocuments.push(data);if(data.classId!==asset.classId||data.academicYear!==manifest.academicYear||data.term.code!==manifest.term||data.revision!==manifest.revision||data.schoolId!==manifest.schoolId)errors.push(`${asset.name}: manifestと内容が一致しません`);}catch(error){errors.push(`${asset.name}: ${error.message}`);}
  }
  if(files.has(vacationAssetName)||files.has(vacationManifestName)){
    names.add(vacationAssetName);names.add(vacationManifestName);
    try{
      const vacations=verifyVacationAssets(files,manifest.revision,baseUrl);
      for(const document of classDocuments)for(const day of document.calendar){
        const vacation=vacations.periods.find(p=>p.start<=day.date&&day.date<=p.confirmedThrough);
        if(vacation&&[day.dayType,day.overrideDayType].some(type=>type==='A'||type==='B'))
          errors.push(`${document.classId} ${day.date}: ${vacation.name}と授業日が重なっています`);
      }
    }catch(error){errors.push(`長期休業: ${error.message}`);}
  }
  for(const name of files.keys())if(!names.has(name))errors.push(`${name}: manifestにないファイルです`);
  if(manifest.classIds.some(id=>!classes.has(id))||classes.size!==manifest.classIds.length)errors.push('manifestの対象クラスが一致しません');
  if(expectedClasses!==undefined){if(!Array.isArray(expectedClasses)||new Set(expectedClasses).size!==expectedClasses.length||expectedClasses.some(id=>!classes.has(id))||classes.size!==expectedClasses.length)errors.push('対象クラスが一致しません');}
  return errors;
}
