import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { exit, stderr, stdin, stdout } from 'node:process';
import { validateVacations } from '../lib/vacations.js';

const [input, output] = process.argv.slice(2);
const fields = ({ reviewed, raw, ...period }) => period;

async function review() {
  if (!input || !output || !stdin.isTTY) {
    throw Error('Usage: node bin/review-vacations.mjs DRAFT.json NEW_REVIEW.json');
  }
  const draft = JSON.parse(await readFile(input, 'utf8'));
  if (!Array.isArray(draft.periods)) throw Error('休業候補が見つかりません');
  const rl = createInterface({input:stdin, output:stdout, terminal:false});
  try {
    for (const period of draft.periods) {
      console.log('\n' + period.name, period.start ?? '開始日未確認', period.reviewed ? '（確認済み）' : '');
      for (const source of period.sources) console.log(' ', source.url ?? source.name, 'p.' + source.page);
      const evidence = draft.periodEvidence?.filter(item => item.id === period.id) ?? [];
      for (const arrow of evidence) {
        const kind = arrow.arrowEndCandidate ? '終点候補' : '続きがある期間の最終日候補';
        console.log('  矢印の' + kind, arrow.arrowEndCandidate ?? arrow.arrowThroughCandidate);
      }
      const start = (await rl.question('照合済みの開始日 (YYYY-MM-DD、空欄でスキップ) ')).trim();
      if (!start) continue;
      const end = (await rl.question('確定した終了日 (YYYY-MM-DD、未確定なら空欄) ')).trim() || null;
      const confirmedThrough = end ?? (await rl.question('休業を確認できた最終日 (YYYY-MM-DD) ')).trim();
      const month = end ? '' : (await rl.question('終了月の目安 (1–12、不明なら空欄) ')).trim();
      const candidate = { ...period, start, end, confirmedThrough, estimatedEndMonth: month ? Number(month) : null };
      try {
        validateVacations({
          format:'SKTJF-VACATIONS', schemaVersion:1, schoolId:'nittc', revision:period.id.slice(0,4)+'.S.0',
          periods:[...draft.periods.filter(item => item !== period && item.reviewed), candidate].map(fields)
        });
        const confirmed = (await rl.question('この内容を確認済みにしますか？ [y/N] ')).trim().toLowerCase();
        if (confirmed === 'y') Object.assign(period, candidate, {reviewed:true});
      } catch (error) {
        console.error('保存せず次の候補へ進みます。' + error.message);
      }
    }
    await writeFile(output, JSON.stringify(draft,null,2)+'\n', {flag:'wx'});
  } finally {
    rl.close();
  }
}

try {
  await review();
  stdout.write('確認結果を保存しました。\n', () => exit(0));
} catch (error) {
  stderr.write(error.message + '\n', () => exit(1));
}
