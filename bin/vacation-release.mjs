import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildVacationAssets, standaloneVacationBase, vacationAssetName, vacationManifestName, verifyVacationAssets
} from '../lib/vacations.js';

const [action, revision, repository, input, output, ...extra] = process.argv.slice(2);
const names = [vacationAssetName, vacationManifestName];

try {
  if (!revision || !repository || !input || extra.length ||
      !((action === 'build' && output) || (action === 'validate' && !output))) {
    throw Error('Usage: node bin/vacation-release.mjs build REVISION OWNER/REPO REVIEW.json NEW_DIRECTORY\n' +
      '       node bin/vacation-release.mjs validate REVISION OWNER/REPO DIRECTORY');
  }
  const base = standaloneVacationBase(repository, revision);
  if (action === 'build') {
    const draft = JSON.parse(await readFile(input, 'utf8'));
    const files = buildVacationAssets(draft, revision, base);
    if (!verifyVacationAssets(files, revision, base).periods.length) throw Error('配信する休業がありません');
    await mkdir(output);
    for (const [name, bytes] of files) await writeFile(join(output, name), bytes, {flag: 'wx'});
  } else {
    const entries = await readdir(input, {withFileTypes: true});
    if (entries.length !== names.length || entries.some(entry => !entry.isFile() || !names.includes(entry.name))) {
      throw Error('休業の配信ファイルは2つ必要です');
    }
    const files = new Map(await Promise.all(names.map(async name => [name, await readFile(join(input, name))])));
    if (!verifyVacationAssets(files, revision, base).periods.length) throw Error('配信する休業がありません');
  }
  console.log(`Valid vacation assets for ${revision}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
