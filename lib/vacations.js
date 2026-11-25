import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseStrictJson } from './strict-json.js';

export const vacationAssetName = 'vacations.json';
export const vacationManifestName = 'vacations.manifest.json';
const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
const validator = name => ajv.compile(JSON.parse(readFileSync(new URL('../schema/' + name, import.meta.url), 'utf8')));
const documentShape = validator('vacations-v1.schema.json');
const manifestShape = validator('vacations-manifest-v1.schema.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (condition, message) => { if (!condition) throw new Error(message); };

export function validateVacations(document) {
  check(documentShape(document), ajv.errorsText(documentShape.errors));
  const ids = new Set();
  for (const period of document.periods) {
    const prefix = period.id.slice(0, 4);
    check(period.id === prefix + '-' + period.type && !ids.has(period.id), '休業IDが重複または不正です');
    ids.add(period.id);
    const year = Number(prefix);
    check(year >= 1900 && year <= 9998 && period.start >= prefix + '-04-01' &&
      period.start <= (year + 1) + '-03-31', '休業の開始日と年度が一致しません');
    check(period.start <= period.confirmedThrough &&
      period.confirmedThrough <= (year + 1) + '-12-31' &&
      (period.end === null || period.end === period.confirmedThrough), '休業期間が正しくありません');
    check(period.end === null || period.estimatedEndMonth === null, '確定済みの休業に終了月の目安は指定できません');
  }
  const sorted = [...document.periods].sort((a,b) => a.start.localeCompare(b.start));
  for (const [index, period] of sorted.entries()) {
    for (const next of sorted.slice(index + 1)) {
      if (period.confirmedThrough < next.start) break;
      const nextYearSpring = period.type === 'year_end' && next.type === 'spring' &&
        Number(period.id.slice(0, 4)) + 1 === Number(next.id.slice(0, 4)) &&
        period.end !== null && period.end <= next.confirmedThrough;
      check(nextYearSpring, '休業の確認済み期間が重複しています');
    }
  }
  return document;
}

export function buildVacationAssets(draft, revision, base) {
  check(Array.isArray(draft.periods) && draft.periods.every(period => period.reviewed === true), '長期休業に未確認の項目があります');
  const periods = draft.periods.map(({reviewed, raw, ...period}) => period);
  const document = validateVacations({format:'SKTJF-VACATIONS', schemaVersion:1, schoolId:'nittc', revision, periods});
  const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n');
  const manifest = {format:'SKTJF-VACATIONS-MANIFEST', manifestVersion:1, schoolId:'nittc', revision,
    asset:{name:vacationAssetName, url:new URL(vacationAssetName,base).href, sha256:sha256(bytes), dataFormatVersion:1}};
  return new Map([[vacationAssetName,bytes],[vacationManifestName,Buffer.from(JSON.stringify(manifest,null,2)+'\n')]]);
}

export function verifyVacationAssets(files, revision, base) {
  const manifest = parseStrictJson(files.get(vacationManifestName), 16 * 1024);
  check(manifestShape(manifest), ajv.errorsText(manifestShape.errors));
  check(manifest.revision === revision && manifest.asset.url === new URL(vacationAssetName,base).href,
    '長期休業manifestの配信元が一致しません');
  const bytes = files.get(vacationAssetName);
  check(Buffer.isBuffer(bytes) && sha256(bytes) === manifest.asset.sha256, '長期休業のSHA-256が一致しません');
  const document = validateVacations(parseStrictJson(bytes, 512 * 1024));
  check(document.revision === revision, '長期休業の配信改訂番号が一致しません');
  return document;
}
