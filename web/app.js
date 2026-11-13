import * as pdfjs from '/node_modules/pdfjs-dist/build/pdf.mjs';
import { History, emptyEntry, isProjectShape, mergeCells, newCell, projectIssues, splitCell, validateRect } from '/web/model.js';

pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
const $ = id => document.getElementById(id);
let history = new History({ version: 1, pdf: null, pdfName: '', cells: [] });
let pdf = null, page = 1, zoom = 1, selected = [], drawing = false, start = null, dirty = false, renderToken = 0;
const current = () => history.current;
const say = text => { $('status').textContent = text; };
const cells = () => current().cells.filter(c => c.page === page);
const selectedCells = () => current().cells.filter(c => selected.includes(c.id));
const changed = (fn, refreshEditor = true) => { history.change(fn); dirty = true; update(refreshEditor); };
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(s); };
const from64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

async function loadPdf() {
  if (!current().pdf) return;
  pdf = await pdfjs.getDocument({ data: from64(current().pdf) }).promise;
  page = Math.min(Math.max(page, 1), pdf.numPages);
  await renderPdf();
}
async function renderPdf() {
  if (!pdf) return;
  const token = ++renderToken;
  const pdfPage = await pdf.getPage(page);
  const viewport = pdfPage.getViewport({ scale: zoom });
  // Render into an offscreen canvas so overlapping zoom operations cannot corrupt it.
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  if (token !== renderToken) return;
  const visible = $('pdf'); visible.width = canvas.width; visible.height = canvas.height;
  visible.getContext('2d').drawImage(canvas, 0, 0);
  $('paper').style.width = `${canvas.width}px`; $('paper').style.height = `${canvas.height}px`;
  update();
}
function update(refreshEditor = true) {
  $('page-label').textContent = pdf ? `${page} / ${pdf.numPages}` : '—';
  $('zoom-label').textContent = `${Math.round(zoom * 100)}%`;
  $('prev').disabled = !pdf || page <= 1; $('next').disabled = !pdf || page >= pdf.numPages;
  $('undo').disabled = !history.undoStack.length; $('redo').disabled = !history.redoStack.length;
  $('draw').setAttribute('aria-pressed', String(drawing));
  $('overlay').classList.toggle('drawing', drawing);
  $('hint').textContent = !pdf ? 'PDFを開いてください' : drawing ? 'PDF上でドラッグしてセルの範囲を指定します' : 'セルを選択して内容を確認します';
  const issues = current().cells.filter(c => !c.reviewed || c.issues.length);
  $('summary').textContent = `${current().pdfName || 'PDF未選択'} · ${current().cells.length}セル · 未確認・要確認 ${issues.length}件`;
  $('next-issue').disabled = !issues.length;
  $('overlay').replaceChildren();
  for (const cell of cells()) {
    const el = document.createElement('button'); el.type = 'button';
    el.className = `cell${cell.reviewed && !cell.issues.length ? ' reviewed' : ''}${selected.includes(cell.id) ? ' selected' : ''}`;
    const [x1, y1, x2, y2] = cell.rect;
    Object.assign(el.style, { left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2-x1)*100}%`, height: `${(y2-y1)*100}%` });
    const title = cell.entries.map(e => e.subject || e.label || e.date).filter(Boolean).join(' / ') || '未入力';
    el.setAttribute('aria-label', `${title}、${cell.reviewed ? '確認済み' : '未確認'}`);
    const label = document.createElement('span'); label.textContent = title; el.append(label);
    el.addEventListener('click', event => { event.stopPropagation(); if (drawing) return; selected = event.ctrlKey || event.metaKey ? selected.includes(cell.id) ? selected.filter(id => id !== cell.id) : [...selected, cell.id] : [cell.id]; update(); });
    $('overlay').append(el);
  }
  if (refreshEditor) renderEditor();
  else { const checkbox=$('editor').querySelector('.review'); if (checkbox) checkbox.checked=false; }
}
const lessonFields = [['subject','科目名'],['teacher','担当教員'],['room','教室'],['day','曜日'],['period','時限'],['classId','対象クラス'],['cycle','A/B'],['attributes','対象学生の条件'],['special','特殊授業種別']];
const calendarFields = [['date','日付'],['dayType','A/B・休日'],['lessonDay','振替先の曜日'],['lessonType','振替先のA/B'],['label','行事名']];
function renderEditor() {
  const host = $('editor'); host.replaceChildren();
  const chosen = selectedCells();
  for (const id of ['split-v','split-h','delete']) $(id).disabled = chosen.length !== 1;
  $('merge').disabled = chosen.length < 2;
  if (chosen.length !== 1) { const p = document.createElement('p'); p.className='empty'; p.textContent = chosen.length ? `${chosen.length}セルを選択中` : 'セルを選択してください'; host.append(p); return; }
  const cell = chosen[0];
  const info = document.createElement('p'); info.className='muted'; info.textContent = `${cell.page}ページ · ${cell.kind === 'lesson' ? '授業' : '日付'} · ${cell.entries.length}件`; host.append(info);
  const extract = document.createElement('button'); extract.textContent='範囲の文字を抽出'; extract.onclick=() => extractText(cell.id); host.append(extract);
  cell.entries.forEach((entry,index) => {
    const section=document.createElement('div'); section.className='entry';
    const heading=document.createElement('h2'); heading.textContent=`内容 ${index+1}`; section.append(heading);
    const grid=document.createElement('div'); grid.className='fields';
    for (const [key,label] of cell.kind === 'lesson' ? lessonFields : calendarFields) {
      const wrapper=document.createElement('label'); wrapper.className=`field${['subject','attributes','label'].includes(key)?' wide':''}`; wrapper.textContent=label;
      const input=document.createElement('input'); input.value=entry[key] || ''; input.addEventListener('change', () => changed(p => { const c=p.cells.find(c=>c.id===cell.id); c.entries[index][key]=input.value; c.reviewed=false; }, false));
      wrapper.append(input); grid.append(wrapper);
    }
    section.append(grid);
    if (cell.entries.length > 1) { const remove=document.createElement('button'); remove.textContent='この内容を削除'; remove.onclick=()=>changed(p=>{ const c=p.cells.find(c=>c.id===cell.id); c.entries.splice(index,1); c.reviewed=false; }); section.append(remove); }
    host.append(section);
  });
  const add=document.createElement('button'); add.textContent='内容を追加'; add.onclick=()=>changed(p=>{ const c=p.cells.find(c=>c.id===cell.id); c.entries.push(emptyEntry(c.kind)); c.reviewed=false; }); host.append(add);
  const issueLabel=document.createElement('label'); issueLabel.className='field wide'; issueLabel.textContent='確認が必要な点（1行ずつ）';
  const issueInput=document.createElement('textarea'); issueInput.value=cell.issues.join('\n'); issueInput.addEventListener('change',()=>changed(p=>{ const c=p.cells.find(c=>c.id===cell.id); c.issues=issueInput.value.split('\n').map(s=>s.trim()).filter(Boolean); c.reviewed=false; }, false)); issueLabel.append(issueInput); host.append(issueLabel);
  const reviewLabel=document.createElement('label'); reviewLabel.className='row'; const review=document.createElement('input'); review.type='checkbox'; review.className='review'; review.checked=cell.reviewed; review.addEventListener('change',()=>changed(p=>{p.cells.find(c=>c.id===cell.id).reviewed=review.checked;})); reviewLabel.append(review,document.createTextNode('確認済み')); host.append(reviewLabel);
}
async function extractText(id) {
  const cell=current().cells.find(c=>c.id===id); if (!cell || !pdf) return;
  const targetPage=await pdf.getPage(cell.page), viewport=targetPage.getViewport({scale:1}), content=await targetPage.getTextContent();
  const text=content.items.filter(item=>{
    if (!item.str || !item.transform) return false;
    const transform=pdfjs.Util.transform(viewport.transform,item.transform); const x=transform[4]/viewport.width, y=transform[5]/viewport.height;
    return x>=cell.rect[0] && x<=cell.rect[2] && y>=cell.rect[1] && y<=cell.rect[3];
  }).map(item=>item.str).join(' ').trim();
  changed(p=>{const c=p.cells.find(c=>c.id===id); const key=c.kind==='lesson'?'subject':'label'; c.entries[0][key]=text; c.reviewed=false; c.issues=[...new Set([...c.issues,'抽出した文字と範囲を確認'])];});
  say(text ? '抽出結果を確認してください' : '範囲内に文字が見つかりませんでした');
}
function point(event) { const r=$('overlay').getBoundingClientRect(); return [Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))]; }
$('overlay').addEventListener('pointerdown',e=>{ if(!drawing||!pdf||e.button!==0)return; start=point(e); $('overlay').setPointerCapture(e.pointerId); const draft=document.createElement('div'); draft.className='draft'; draft.id='draft'; $('overlay').append(draft); });
$('overlay').addEventListener('pointermove',e=>{ if(!start)return; const end=point(e),draft=$('draft'); if(!draft)return; Object.assign(draft.style,{left:`${Math.min(start[0],end[0])*100}%`,top:`${Math.min(start[1],end[1])*100}%`,width:`${Math.abs(start[0]-end[0])*100}%`,height:`${Math.abs(start[1]-end[1])*100}%`}); });
$('overlay').addEventListener('pointerup',e=>{ if(!start)return; const end=point(e),rect=[Math.min(start[0],end[0]),Math.min(start[1],end[1]),Math.max(start[0],end[0]),Math.max(start[1],end[1])]; start=null; $('draft')?.remove(); if(!validateRect(rect)||rect[2]-rect[0]<.003||rect[3]-rect[1]<.003)return; const cell=newCell(page,rect,$('kind').value); selected=[cell.id]; drawing=false; changed(p=>p.cells.push(cell)); });
$('overlay').addEventListener('pointercancel',()=>{start=null; $('draft')?.remove();});
$('draw').onclick=()=>{drawing=!drawing; update();};
$('prev').onclick=()=>{page--;selected=[];renderPdf().catch(error=>say(error.message));};
$('next').onclick=()=>{page++;selected=[];renderPdf().catch(error=>say(error.message));};
$('zoom-in').onclick=()=>{zoom=Math.min(3,zoom+.25);renderPdf().catch(error=>say(error.message));};
$('zoom-out').onclick=()=>{zoom=Math.max(.5,zoom-.25);renderPdf().catch(error=>say(error.message));};
$('undo').onclick=()=>{if(history.undo()){dirty=true;selected=[];update();}};
$('redo').onclick=()=>{if(history.redo()){dirty=true;selected=[];update();}};
for (const [id,direction] of [['split-v','vertical'],['split-h','horizontal']]) $(id).onclick=()=>{const cell=selectedCells()[0]; if(!cell)return; const parts=splitCell(cell,direction); selected=parts.map(c=>c.id); changed(p=>{p.cells.splice(p.cells.findIndex(c=>c.id===cell.id),1,...parts);});};
$('merge').onclick=()=>{try{const chosen=selectedCells(),merged=mergeCells(chosen); selected=[merged.id]; changed(p=>{p.cells=p.cells.filter(c=>!chosen.some(x=>x.id===c.id));p.cells.push(merged);});}catch(error){say(error.message);}};
$('delete').onclick=()=>{const id=selected[0]; if(!id)return; selected=[];changed(p=>{p.cells=p.cells.filter(c=>c.id!==id);});};
$('next-issue').onclick=()=>{const list=current().cells.filter(c=>!c.reviewed||c.issues.length),index=list.findIndex(c=>c.id===selected[0]),cell=list[(index+1)%list.length];if(!cell)return; selected=[cell.id];if(page!==cell.page){page=cell.page;renderPdf().catch(error=>say(error.message));}else update();};
const fileText = file => file.text();
function canReplace() { return !dirty || confirm('保存していない変更があります。別のファイルを開きますか？'); }
$('pdf-input').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file||!canReplace())return;try{const bytes=new Uint8Array(await file.arrayBuffer());const doc=await pdfjs.getDocument({data:bytes.slice()}).promise;history=new History({version:1,pdf:b64(bytes),pdfName:file.name,cells:[]});pdf=doc;page=1;selected=[];dirty=true;await renderPdf();say('');}catch{say('PDFを開けませんでした');}};
$('project-input').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file||!canReplace())return;try{const project=JSON.parse(await fileText(file));if(!isProjectShape(project))throw Error();const doc=await pdfjs.getDocument({data:from64(project.pdf)}).promise;if(project.cells.some(c=>c.page>doc.numPages))throw Error();history=new History(project);pdf=doc;page=1;selected=[];dirty=false;await renderPdf();say('作業を開きました');}catch{say('作業ファイルを開けませんでした');}};
$('save').onclick=()=>{if(!current().pdf){say('PDFを開いてください');return;}const blob=new Blob([JSON.stringify(current())],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${current().pdfName.replace(/\.pdf$/i,'')}.sktjf-project.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);dirty=false;say(`作業ファイルを保存しました。未解決項目: ${projectIssues(current()).length}件`);};
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
window.addEventListener('copy',event=>{if(event.target.matches('input,textarea,select')||selected.length!==1)return;const cell=selectedCells()[0];if(!cell)return;event.clipboardData.setData('text/plain',JSON.stringify({format:'sktjf-cell-entries',kind:cell.kind,entries:cell.entries}));event.preventDefault();say('内容をコピーしました');});
window.addEventListener('paste',event=>{if(event.target.matches('input,textarea,select')||selected.length!==1)return;const cell=selectedCells()[0],text=event.clipboardData.getData('text/plain');if(!cell||!text)return;let entries;try{const copied=JSON.parse(text);if(copied.format!=='sktjf-cell-entries'||copied.kind!==cell.kind||!Array.isArray(copied.entries)||!copied.entries.length||!copied.entries.every(e=>e&&typeof e==='object'&&!Array.isArray(e)&&Object.values(e).every(v=>typeof v==='string')))throw Error();entries=copied.entries;}catch{entries=[{...emptyEntry(cell.kind),[cell.kind==='lesson'?'subject':'label']:text}];}event.preventDefault();changed(p=>{const c=p.cells.find(c=>c.id===cell.id);c.entries=structuredClone(entries);c.reviewed=false;});say('内容を貼り付けました');});
window.addEventListener('keydown',event=>{if(event.target.matches('input,textarea,select'))return;const command=event.ctrlKey||event.metaKey;if(command&&event.key.toLowerCase()==='z'){event.preventDefault();(event.shiftKey?$('redo'):$('undo')).click();}else if(command&&event.key.toLowerCase()==='y'){event.preventDefault();$('redo').click();}else if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(event.key)&&cells().length){event.preventDefault();const list=cells(),i=list.findIndex(c=>c.id===selected[0]),step=['ArrowRight','ArrowDown'].includes(event.key)?1:-1;selected=[list[(i+step+list.length)%list.length].id];update();}});
update();
