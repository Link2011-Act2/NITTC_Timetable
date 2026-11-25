import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { calendarPdfLinks, schoolCalendarPage, vacationCandidates } from '../lib/vacation-discovery.js';

async function get(url) {
  const response = await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20_000)});
  if(!response.ok)throw Error(`公式資料を取得できませんでした (HTTP ${response.status})`);
  return response;
}

try {
  const [year,output,...local]=process.argv.slice(2);
  const academicYear=Number(year);
  if(!/^\d{4}$/.test(year??'')||academicYear<2019||academicYear>9998||!output)
    throw Error('Usage: node bin/extract-vacations.mjs YEAR NEW_DRAFT.json [SPRING_PDF FALL_PDF]');
  const inputs=[];
  if(local.length){
    for(const path of local)inputs.push({bytes:await readFile(path),name:basename(path),url:null});
  } else {
    const links=calendarPdfLinks(await (await get(schoolCalendarPage)).text(),academicYear);
    if(!links.S&&!links.F)throw Error('対象年度のPDFを取得できません。PDFファイルを指定してください');
    for(const url of Object.values(links))inputs.push({bytes:Buffer.from(await (await get(url)).arrayBuffer()),name:decodeURIComponent(new URL(url).pathname.split('/').at(-1)),url});
  }
  const results=await Promise.all(inputs.map(input=>vacationCandidates(input.bytes,{...input,academicYear})));
  const periods=results.flatMap(result=>result.candidates);
  const periodEvidence=results.flatMap(result=>result.periodEvidence);
  for(const period of periods){
    const evidence=periodEvidence.find(item=>item.id===period.id);
    const hint=evidence?.arrowEndCandidate ? `（矢印の終点候補: ${evidence.arrowEndCandidate}）`
      : evidence ? `（矢印を確認できる最終日候補: ${evidence.arrowThroughCandidate}）` : '';
    console.log(`${period.name}  ${period.start??'開始日未確認'} ～ 終了日未確認${hint}`);
  }
  await writeFile(output,JSON.stringify({periods,periodEvidence,lessonStarts:results.flatMap(result=>result.lessonStarts)},null,2)+'\n',{flag:'wx'});
} catch(error) { console.error(error.message);process.exitCode=1; }
