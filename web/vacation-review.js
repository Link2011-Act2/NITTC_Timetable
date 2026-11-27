import * as pdfjs from '/node_modules/pdfjs-dist/build/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
const $ = id => document.getElementById(id);
const form = $('entry');
const fields = ['name', 'start', 'end', 'confirmedThrough', 'estimatedEndMonth'];
const documents = new Map();
let draft, fileName, selected, currentPdf;
let page = 1, zoom = 1, renderToken = 0, openToken = 0, dirty = false, approving = false;

const status = message => { $('status').textContent = message; };
const current = () => draft?.periods.find(period => period.id === selected);

function button(label, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.onclick = action;
  return element;
}

function renderList() {
  const pending = draft.periods.filter(period => !period.reviewed).length;
  $('summary').textContent = `承認済み ${draft.periods.length - pending}件・未承認 ${pending}件`;
  $('period-list').replaceChildren(...draft.periods.map(period => {
    const item = button(`${period.name || '休業'} · ${period.reviewed ? '承認済み' : '未承認'}`, () => selectPeriod(period.id));
    item.setAttribute('aria-pressed', String(period.id === selected));
    return item;
  }));
  $('approve').disabled = approving || current()?.reviewed === true;
  $('unapprove').hidden = current()?.reviewed !== true;
}

function edit(period, key, value) {
  if (period[key] === value) return;
  period[key] = value;
  period.reviewed = false;
  dirty = true;
  renderList();
}

function pdfControls() {
  $('pdf-source').replaceChildren(new Option('PDFを選択', ''), ...[...documents.values()].map(pdf => new Option(pdf.name, pdf.hash)));
  $('pdf-source').disabled = documents.size === 0;
  $('pdf-source').value = currentPdf?.hash || '';
  $('pdf-name').textContent = currentPdf?.name || '出典PDFを開いて照合できます';
  $('page').textContent = currentPdf ? `${page} / ${currentPdf.doc.numPages}` : '—';
  $('prev').disabled = !currentPdf || page === 1;
  $('next').disabled = !currentPdf || page >= currentPdf.doc.numPages;
  $('zoom-out').disabled = !currentPdf || zoom <= 0.5;
  $('zoom-in').disabled = !currentPdf || zoom >= 3;
  $('add-source').disabled = !currentPdf || !current() ||
    current().sources.some(source => source.sha256 === currentPdf.hash && source.page === page);
}

async function showPdf(source) {
  const token = ++renderToken;
  currentPdf = source && documents.get(source.sha256);
  page = source?.page || 1;
  $('pdf').hidden = true;
  if (!currentPdf || page > currentPdf.doc.numPages) {
    currentPdf = undefined;
    pdfControls();
    if (source) $('pdf-name').textContent = `${source.name}（${source.page}ページ）`;
    return;
  }
  pdfControls();
  try {
    const pdfPage = await currentPdf.doc.getPage(page);
    const viewport = pdfPage.getViewport({scale: zoom});
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await pdfPage.render({canvas, viewport}).promise;
    if (token !== renderToken) return;
    const preview = $('pdf');
    preview.width = canvas.width;
    preview.height = canvas.height;
    preview.getContext('2d').drawImage(canvas, 0, 0);
    preview.hidden = false;
  } catch {
    if (token === renderToken) status('PDFのページを表示できませんでした');
  }
}

function renderSources(period) {
  $('sources').replaceChildren(...period.sources.map((source, index) => {
    const card = document.createElement('div');
    card.className = 'entry';
    const grid = document.createElement('div');
    grid.className = 'fields';
    for (const [key, labelText, type] of [['name', 'PDF名', 'text'], ['page', 'ページ番号', 'number'], ['url', '出典URL', 'url']]) {
      const label = document.createElement('label');
      label.className = 'field';
      label.textContent = labelText;
      const input = document.createElement('input');
      input.type = type;
      input.value = source[key] ?? '';
      if (key === 'page') { input.min = '1'; input.required = true; }
      input.oninput = () => {
        const value = key === 'page' ? input.valueAsNumber || null : input.value.trim() || null;
        const existing = period.sources[index];
        if (existing[key] === value) return;
        edit(period, 'sources', period.sources.map((item, i) => i === index ? {...item, [key]: value} : item));
        pdfControls();
      };
      label.append(input);
      grid.append(label);
    }
    const actions = document.createElement('div');
    actions.className = 'toolbar';
    actions.append(button('この出典を表示', () => {
      const item = period.sources[index];
      if (!documents.has(item.sha256)) status('照合するPDFを開いてください');
      else if (!(item.page >= 1 && item.page <= documents.get(item.sha256).doc.numPages)) {
        status('出典のページ番号を確認してください');
        return;
      } else status('');
      showPdf(item);
    }), button('出典を外す', () => {
      edit(period, 'sources', period.sources.filter((_, i) => i !== index));
      renderSources(period);
      pdfControls();
    }));
    card.append(grid, actions);
    return card;
  }));
}

function selectPeriod(id) {
  selected = id;
  const period = current();
  form.hidden = !period;
  renderList();
  if (!period) { showPdf(null); return; }
  for (const key of fields) form.elements[key].value = period[key] ?? '';
  form.elements.estimatedEndMonth.disabled = period.end != null;
  const hints = (draft.periodEvidence || []).filter(item => item?.id === id).map(item => item.arrowEndCandidate
    ? `終了日候補 ${item.arrowEndCandidate}`
    : item.arrowThroughCandidate ? `矢印を確認できた最終日 ${item.arrowThroughCandidate}` : '');
  $('evidence').textContent = [period.raw, ...hints].filter(Boolean).join('\n');
  $('evidence').hidden = !$('evidence').textContent;
  renderSources(period);
  showPdf(period.sources[0]);
}

for (const key of fields) form.elements[key].oninput = () => {
  const period = current();
  const input = form.elements[key];
  const value = key === 'estimatedEndMonth' ? input.valueAsNumber || null : input.value.trim() || null;
  edit(period, key, value);
  if (key === 'end') {
    form.elements.estimatedEndMonth.disabled = value !== null;
    if (value !== null) {
      edit(period, 'confirmedThrough', value);
      edit(period, 'estimatedEndMonth', null);
      form.elements.confirmedThrough.value = value;
      form.elements.estimatedEndMonth.value = '';
    }
  }
};

$('draft').onchange = async event => {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file || (dirty && !confirm('保存していない変更を破棄しますか？'))) return;
  const token = ++openToken;
  try {
    if (file.size > 1024 * 1024) throw Error('監修ファイルが大きすぎます');
    const input = JSON.parse(await file.text());
    if (token !== openToken) return;
    if (!Array.isArray(input?.periods) || !input.periods.length || input.periods.length > 128 ||
        new Set(input.periods.map(period => period?.id)).size !== input.periods.length ||
        input.periods.some(period => !/^[0-9]{4}-(summer|winter|year_end|spring)$/.test(period?.id) ||
          !Array.isArray(period.sources) || period.sources.some(source => !source || typeof source.name !== 'string')) ||
        (input.periodEvidence != null && !Array.isArray(input.periodEvidence))) {
      throw Error('長期休業の監修ファイルを選んでください');
    }
    draft = input;
    fileName = file.name;
    dirty = false;
    $('save').disabled = false;
    selectPeriod(input.periods[0].id);
    status('');
  } catch (error) { if (token === openToken) status(error.message); }
};

$('pdf-input').onchange = async event => {
  const files = [...event.target.files];
  event.target.value = '';
  let last;
  try {
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
      if (!documents.has(hash)) {
        const doc = await pdfjs.getDocument({data: bytes}).promise;
        documents.set(hash, {name: file.name, hash, doc});
      }
      last = hash;
    }
    if (!last) return;
    const source = current()?.sources.find(item => documents.has(item.sha256));
    await showPdf(source || {sha256: last, page: 1});
    status(source || !current() ? '' : 'このPDFは選択中の休業の出典に登録されていません');
  } catch { status('PDFを開けませんでした'); }
};

function redrawPdf() {
  if (currentPdf) showPdf({sha256: currentPdf.hash, page});
}
$('prev').onclick = () => { page--; redrawPdf(); };
$('next').onclick = () => { page++; redrawPdf(); };
$('pdf-source').onchange = event => {
  const hash = event.target.value;
  const source = current()?.sources.find(item => item.sha256 === hash);
  showPdf(hash ? source || {sha256: hash, page: 1} : null);
};
$('zoom-out').onclick = () => { zoom = Math.max(0.5, zoom - 0.25); redrawPdf(); };
$('zoom-in').onclick = () => { zoom = Math.min(3, zoom + 0.25); redrawPdf(); };
$('add-source').onclick = () => {
  const period = current();
  edit(period, 'sources', [...period.sources, {name: currentPdf.name, sha256: currentPdf.hash, page, url: null}]);
  renderSources(period);
  pdfControls();
};

form.onsubmit = async event => {
  event.preventDefault();
  const period = current();
  if (period.sources.some(source => documents.has(source.sha256) && source.page > documents.get(source.sha256).doc.numPages)) {
    status('出典のページ番号を確認してください');
    return;
  }
  const snapshot = JSON.stringify(draft);
  approving = true;
  renderList();
  try {
    const response = await fetch('/api/review-vacation', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: period.id, draft})
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '休業期間を確認してください');
    if (current() !== period || JSON.stringify(draft) !== snapshot) {
      status('変更後の内容でもう一度承認してください');
      return;
    }
    period.reviewed = true;
    dirty = true;
    status('承認しました。監修ファイルを保存してください');
  } catch (error) { status(error.message); }
  finally { approving = false; renderList(); }
};
$('unapprove').onclick = () => { edit(current(), 'reviewed', false); status('未承認に戻しました'); };
$('save').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2) + '\n'], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.replace(/\.json$/i, '') + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  dirty = false;
  status('監修ファイルのダウンロードを開始しました');
};
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
