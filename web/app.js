import * as pdfjs from '/node_modules/pdfjs-dist/build/pdf.mjs';
import { isProjectShape } from './model.js';
import { addSourcePreservingEdits, adjacentVisibleSlot, applyReviewPlan, captureHistory, cellProblems, classIds, dateAdd, emptyDay, emptyLesson, emptyProject, ensureEntryIds, exportConfigForTerm, setExportConfigForTerm, History, historyUnchanged, initialProjectView, lessonAt, matchesSavedSnapshot, migrateV1, migrateV2, missingCalendarRange, missingSlots, mondayOf, nextReviewItem, pasteTableCell, periodCount, placeLegacyEntry, planReviewRange, putLesson, reviewItems, validClassId, validProject } from './table-model.js';
import { extractPage } from './extract.js';
pdfjs.GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/build/pdf.worker.mjs';
const $=id=>document.getElementById(id), weekday=['月','火','水','木','金','土','日'];
let history=new History(emptyProject(null,'',2026,'S')), pdf=null, sourceId='', page=1, zoom=1, tableZoom=1, view='lesson', selection=null, dirty=false, renderToken=0, sourceRequest=0, saving=false;
let sourcePageCounts=new Map();
const project=()=>history.current, say=t=>{$('status').textContent=t;};
const to64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};
const from64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const sha256=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
for(const value of classIds){const o=document.createElement('option');o.value=value;$('class-options').append(o);}
let lastClassId=$('class-id').value;
for(let i=1;i<=12;i++){const label=document.createElement('label');label.className='field';label.dataset.period=i;label.textContent=`${i}時限の開始・終了`;const times=document.createElement('span');for(const part of ['start','end']){const input=document.createElement('input');input.type='time';input.id=`period-${i}-${part}`;input.setAttribute('aria-label',`${i}時限の${part==='start'?'開始':'終了'}`);times.append(input);}label.append(times);$('period-times').append(label);}
const exportFields=['export-scope','export-start','export-end','export-revision',...Array.from({length:12},(_,i)=>[`period-${i+1}-start`,`period-${i+1}-end`]).flat()];
for(const id of exportFields)$(id).oninput=()=>{const values=Object.fromEntries(exportFields.map(key=>[key,$(key).value]));values['coverage-confirmed']='false';history.change(p=>setExportConfigForTerm(p,$('term').value,values));$('coverage-confirmed').checked=false;dirty=true;updateControls();};
$('coverage-confirmed').onchange=()=>{const checked=$('coverage-confirmed').checked;history.change(p=>setExportConfigForTerm(p,$('term').value,{...exportConfigForTerm(p,$('term').value),'coverage-confirmed':String(checked)}));dirty=true;updateControls();};
function restoreExportConfig(config={}){for(const id of exportFields)$(id).value=config[id]??(id==='export-revision'?'0':'');$('coverage-confirmed').checked=false;}
function invalidateCoverage(){if($('coverage-confirmed').checked){history.change(p=>{p.exportConfig={...p.exportConfig,'coverage-confirmed':'false'};});$('coverage-confirmed').checked=false;dirty=true;}}
function change(fn, editor=true){history.change(p=>{fn(p);if(p.exportConfig)p.exportConfig['coverage-confirmed']='false';});$('coverage-confirmed').checked=false;$('bulk-status').textContent='';dirty=true;renderTable();updateControls();if(editor)renderEditor();else{const box=$('editor').querySelector('.review');if(box)box.checked=false;updateCellProblems();}}
const visibleMissing=()=>missingSlots(project(),view,$('term').value,$('class-id').value,$('scope').value);
function updateControls(){
  $('period-count').value=periodCount(project());for(const label of $('period-times').children)label.hidden=Number(label.dataset.period)>periodCount(project());
  const source=project().sources.find(s=>s.id===sourceId);$('pdf-name').textContent=source?.name||'PDFを追加してください';$('source').replaceChildren(...project().sources.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;return o;}));$('source').value=sourceId;$('source').disabled=project().sources.length<2;$('year').disabled=project().sources.length>0;$('page-label').textContent=pdf?`${page} / ${pdf.numPages}`:'—';$('zoom-label').textContent=`${Math.round(zoom*100)}%`;
  $('prev').disabled=!pdf||page<=1;$('next').disabled=!pdf||page>=pdf.numPages;$('undo').disabled=!history.undoStack.length;$('redo').disabled=!history.redoStack.length;
  $('lesson-tab').setAttribute('aria-pressed',String(view==='lesson'));$('calendar-tab').setAttribute('aria-pressed',String(view==='calendar'));
  for(const id of ['scope-label','week-label','add-week','calendar-range'])$(id).hidden=view!=='calendar';
  $('bulk-lesson').hidden=view!=='lesson';$('bulk-calendar').hidden=view!=='calendar';
  for(const id of ['bulk-first-period','bulk-last-period']){const input=$(id);input.max=periodCount(project());if(Number(input.value)>periodCount(project()))input.value=periodCount(project());}
  $('range-source').disabled=!pdf;if(!pdf)$('range-source').checked=false;
  const pending=project().lessons.filter(c=>!c.reviewed).length+project().calendar.filter(c=>!c.reviewed).length;
  const problems=project().lessons.filter(c=>cellProblems(project(),'lesson',c,sourcePageCounts).length).length+project().calendar.filter(c=>cellProblems(project(),'calendar',c,sourcePageCounts).length).length;
  const missing=visibleMissing().length;
  $('summary').textContent=`未確認 ${pending}件 · 要修正 ${problems}件 · 表示中の未入力 ${missing}件${project().legacyCells.length?` · 旧作業 ${project().legacyCells.length}件`:''}`;
  $('next-issue').disabled=!reviewItems(project(),sourcePageCounts).length;$('next-missing').disabled=!missing;
  $('scopes').replaceChildren(...[...new Set(project().calendar.map(c=>c.scope))].map(scope=>{const option=document.createElement('option');option.value=scope;return option;}));
  const warnings=$('warnings');warnings.replaceChildren();for(const [index,warning] of (project().warnings||[]).entries()){const row=document.createElement('div');row.className='row';const text=document.createElement('span');text.textContent=warning.message;const resolve=document.createElement('button');resolve.textContent='確認済みにする';resolve.onclick=()=>change(p=>{p.warnings.splice(index,1);});row.append(text,resolve);warnings.append(row);}
  renderLegacy();
}
function renderLegacy(){
  const host=$('legacy');host.replaceChildren();host.hidden=!project().legacyCells.length;if(host.hidden)return;
  const title=document.createElement('h2');title.textContent='旧データの配置';host.append(title);
  const help=document.createElement('p');help.textContent='表で配置先を選び、内容を追加してください。';host.append(help);
  const labels={subject:'科目名',teacher:'担当教員',room:'教室',day:'曜日',period:'時限',classId:'クラス',cycle:'A/B',attributes:'対象学生',special:'授業の種類',date:'日付',dayType:'A/B・休日',lessonDay:'振替先の曜日',lessonType:'振替先のA/B',label:'行事名'};
  project().legacyCells.forEach((cell,cellIndex)=>{
    if(!cell||typeof cell!=='object'||Array.isArray(cell)){const error=document.createElement('p');error.textContent='旧データの内容を読み取れませんでした';host.append(error);return;}
    const group=document.createElement('div');group.className='legacy-group';const heading=document.createElement('h3');heading.textContent=`${cell.page||'不明'}ページ · ${cell.kind==='calendar'?'日付':'授業'}`;group.append(heading);
    if(Array.isArray(cell.issues)&&cell.issues.length){const issues=document.createElement('p');issues.textContent=cell.issues.join('・');group.append(issues);}
    if(!Array.isArray(cell.entries)){const error=document.createElement('p');error.textContent='内容を読み取れませんでした';group.append(error);}
    else cell.entries.forEach((entry,entryIndex)=>{
      const row=document.createElement('div');row.className='legacy-entry';const content=document.createElement('p');
      content.textContent=entry&&typeof entry==='object'?Object.entries(entry).filter(([key,value])=>key!=='id'&&typeof value==='string'&&value.trim()).map(([key,value])=>`${labels[key]||key}: ${value}`).join(' / ')||'内容なし':'内容を読み取れませんでした';
      const add=document.createElement('button');add.type='button';add.textContent='選択したセルに追加';add.onclick=()=>{try{const destination=selection?.kind==='lesson'?{...selection,term:$('term').value,classId:$('class-id').value}:selection?.kind==='calendar'?{...selection,scope:$('scope').value}:null;change(p=>placeLegacyEntry(p,cellIndex,entryIndex,destination));say('旧データを追加しました');}catch(error){say(error.message||'追加できませんでした');}};
      row.append(content,add);group.append(row);
    });host.append(group);
  });
}
async function renderPdf(){
  if(!pdf)return;const token=++renderToken,currentPdf=pdf,currentPage=page,currentZoom=zoom;
  try{const p=await currentPdf.getPage(currentPage),viewport=p.getViewport({scale:currentZoom}),buffer=document.createElement('canvas');buffer.width=Math.ceil(viewport.width);buffer.height=Math.ceil(viewport.height);await p.render({canvasContext:buffer.getContext('2d'),viewport}).promise;if(token!==renderToken)return;const c=$('pdf');c.width=buffer.width;c.height=buffer.height;c.getContext('2d').drawImage(buffer,0,0);updateControls();}
  catch(error){if(token===renderToken)throw error;}
}
async function showSource(id,requestedPage=1){
  const request=++sourceRequest,source=project().sources.find(s=>s.id===id),activeHistory=history;
  renderToken++;
  if(!source){pdf=null;sourceId='';$('pdf').width=0;$('pdf').height=0;updateControls();return;}
  try{
    const doc=await pdfjs.getDocument({data:from64(source.data)}).promise;
    if(request!==sourceRequest||history!==activeHistory||!project().sources.some(s=>s.id===id&&s.data===source.data)){await doc.destroy().catch(()=>{});return;}
    if(!Number.isInteger(requestedPage)||requestedPage<1||requestedPage>doc.numPages){await doc.destroy().catch(()=>{});throw Error('参照ページを確認してください');}
    const previous=pdf;sourcePageCounts.set(id,doc.numPages);sourceId=id;pdf=doc;page=requestedPage;
    if(previous&&previous!==doc)previous.destroy().catch(()=>{});
    renderTable();updateCellProblems();await renderPdf();return request===sourceRequest;
  }catch(error){if(request===sourceRequest)throw error;}
}
function getLesson(day,period){return lessonAt(project(),$('term').value,$('class-id').value,day,period);}
function getDay(date){return project().calendar.find(c=>c.date===date&&c.scope===$('scope').value);}
function sameSelection(key){return selection&&JSON.stringify(selection)===JSON.stringify(key);}
function showSelectedEditor(){document.querySelector('.details-scroll').scrollTop=0;}
function createSlot(key,cell,text,optional=false){const b=document.createElement('button'),invalid=cellProblems(project(),key.kind,cell,sourcePageCounts).length>0;b.type='button';b.className=`slot${!cell?(optional?' optional':' missing'):!cell.reviewed?' pending':''}${invalid?' invalid':''}${sameSelection(key)?' selected':''}`;b.textContent=text||'＋';b.setAttribute('aria-label',`${key.kind==='lesson'?`${weekday[key.day-1]}曜 ${key.period}時限` : key.date} ${text||'空欄'}${!cell?(optional?' 未登録':' 未入力'):!cell.reviewed?' 未確認':''}${invalid?' 要修正':''}`);b.onclick=()=>{selection=key;renderTable();renderEditor();showSelectedEditor();document.querySelector('.slot.selected')?.focus({preventScroll:true});};b.dataset.key=JSON.stringify(key);return b;}
function renderTable(){
  const root=$('table-wrap');root.replaceChildren();const table=document.createElement('table');table.className=`table ${view==='calendar'?'calendar':''}`;const head=document.createElement('tr');for(const name of [view==='lesson'?'時限':'週',...(view==='lesson'?weekday.slice(0,5):weekday)]){const th=document.createElement('th');th.textContent=name;head.append(th);}table.append(head);
  if(view==='lesson')for(let period=1;period<=periodCount(project());period++){const tr=document.createElement('tr'),th=document.createElement('th');th.textContent=String(period);tr.append(th);for(let day=1;day<=5;day++){const td=document.createElement('td'),c=getLesson(day,period);td.append(createSlot({kind:'lesson',day,period},c,c?.state==='EXCLUDED'?'配信対象外':c&&!c.entries.length?'空欄':c?.entries.map(e=>[e.cycle,e.subject,e.teacher,e.room].filter(Boolean).join(' ')).join('\n')));tr.append(td);}table.append(tr);}
  else{const weeks=[...new Set(project().calendar.filter(c=>c.scope===$('scope').value).map(c=>mondayOf(c.date)))].sort();for(const week of weeks){const tr=document.createElement('tr'),th=document.createElement('th');th.textContent=week.slice(5);tr.append(th);for(let i=0;i<7;i++){const date=dateAdd(week,i),c=getDay(date),td=document.createElement('td');td.append(createSlot({kind:'calendar',date},c,[date.slice(5),c?.dayType==='HOLIDAY'?'休日':c?.dayType,c?.lessonDay?`(${weekday[Number(c.lessonDay)-1]||c.lessonDay})`:null,c?.label].filter(Boolean).join(' '),i>=5));tr.append(td);}table.append(tr);}if(!weeks.length){const p=document.createElement('p');p.className='empty';p.textContent='週を追加して入力できます';root.append(p);}}
  root.append(table);document.querySelector('.data-scroll').style.setProperty('--scale',tableZoom);
}
function field(container,label,value,onChange){const wrap=document.createElement('label');wrap.className='field';wrap.textContent=label;const input=document.createElement('input');input.dataset.historyField=label;input.value=value||'';input.oninput=()=>onChange(input.value);wrap.append(input);container.append(wrap);}
function choice(container,label,value,items,onChange){const wrap=document.createElement('label');wrap.className='field';wrap.textContent=label;const select=document.createElement('select');select.dataset.historyField=label;if(value&&!items.some(([v])=>v===value)){const option=document.createElement('option');option.value=value;option.textContent=`要確認: ${value}`;select.append(option);}for(const [v,name] of items){const option=document.createElement('option');option.value=v;option.textContent=name;select.append(option);}select.value=value||'';select.onchange=()=>onChange(select.value);wrap.append(select);container.append(wrap);}
function sourceControls(root,cell,save){
  const grid=document.createElement('div');grid.className='fields';
  choice(grid,'参照するPDF',cell.sourceId,[['','選択してください'],...project().sources.map(s=>[s.id,s.name])],v=>save('sourceId',v));
  field(grid,'参照ページ',String(cell.sourcePage||''),v=>save('sourcePage',/^\d+$/.test(v)&&Number(v)>0?Number(v):null));root.append(grid);
  const show=document.createElement('button');show.type='button';show.textContent='参照PDFを表示';
  show.onclick=()=>{
    const current=(selection?.kind==='lesson'?getLesson(selection.day,selection.period):selection?.kind==='calendar'?getDay(selection.date):null)||cell;
    if(!current.sourceId||!project().sources.some(source=>source.id===current.sourceId)||!Number.isInteger(current.sourcePage)||current.sourcePage<1){say('参照するPDFとページを指定してください');return;}
    if(sourcePageCounts.has(current.sourceId)&&current.sourcePage>sourcePageCounts.get(current.sourceId)){say('参照ページを確認してください');return;}
    showSource(current.sourceId,current.sourcePage).then(shown=>{if(shown)say('');}).catch(error=>say(error.message||'PDFを表示できませんでした'));
  };root.append(show);
}
function updateCellProblems(){const list=$('editor').querySelector('.cell-problems');if(!list||!selection)return;const cell=selection.kind==='lesson'?getLesson(selection.day,selection.period):getDay(selection.date),problems=cellProblems(project(),selection.kind,cell,sourcePageCounts);list.replaceChildren(...problems.map(problem=>{const item=document.createElement('li');item.textContent=problem;return item;}));list.hidden=!problems.length;}
function renderEditor(){
  const root=$('editor');root.replaceChildren();if(!selection){root.textContent='表のセルを選択してください';root.className='empty';return;}root.className='';const title=document.createElement('h2');title.textContent=selection.kind==='lesson'?`${$('class-id').value} · ${weekday[selection.day-1]}曜 ${selection.period}時限`:selection.date;root.append(title);
  const list=document.createElement('ul');list.className='cell-problems';root.append(list);updateCellProblems();
  if(selection.kind==='lesson'){
    const saved=getLesson(selection.day,selection.period),cell=saved||{term:$('term').value,classId:$('class-id').value,day:selection.day,period:selection.period,entries:[emptyLesson()],reviewed:false,raw:'',sourceId,sourcePage:page};
    if(cell.raw){const raw=document.createElement('p');raw.className='extracted-text';raw.textContent=`抽出された文字: ${cell.raw}`;root.append(raw);}
    sourceControls(root,cell,(key,value)=>change(p=>{const c=structuredClone(getLesson(selection.day,selection.period)||cell);c[key]=value;c.reviewed=false;putLesson(p,c);},false));
    const set=(index,key,value)=>change(p=>{const c=structuredClone(getLesson(selection.day,selection.period)||cell);c.entries[index][key]=value;if(key==='subject')c.rawUnparsed=false;c.state='PRESENT';c.reviewed=false;putLesson(p,c);},false);
    cell.entries.forEach((entry,index)=>{const box=document.createElement('div');box.className='entry';box.dataset.historyEntry=entry.id||String(index);const h=document.createElement('h3');h.textContent=`授業 ${index+1}`;box.append(h);const grid=document.createElement('div');grid.className='fields';for(const [key,label] of [['subject','科目名'],['teacher','担当教員'],['room','教室'],['attributes','対象学生の属性'],['excludedAttributes','対象外の属性']])field(grid,label,entry[key],v=>set(index,key,v));choice(grid,'授業の週',entry.cycle,[['','毎週'],['A','A週'],['B','B週']],v=>set(index,'cycle',v));choice(grid,'授業形式',entry.remote,[['','指定なし'],['yes','遠隔'],['no','対面']],v=>set(index,'remote',v));choice(grid,'授業の種類',entry.special,[['','通常授業'],['MAKEUP','補講'],['EXTENSION','延長枠']],v=>set(index,'special',v));box.append(grid);if(cell.entries.length>1){const del=document.createElement('button');del.textContent='この授業を削除';del.onclick=()=>change(p=>{const c=structuredClone(getLesson(selection.day,selection.period)||cell);c.entries.splice(index,1);c.reviewed=false;putLesson(p,c);});box.append(del);}root.append(box);});
    const add=document.createElement('button');add.textContent='授業を追加';add.onclick=()=>change(p=>{const c=structuredClone(getLesson(selection.day,selection.period)||cell);c.entries.push(emptyLesson());c.state='PRESENT';c.reviewed=false;putLesson(p,c);});root.append(add);
    const del=document.createElement('button');del.textContent='この枠を空欄にする';del.onclick=()=>change(p=>putLesson(p,{...(getLesson(selection.day,selection.period)||cell),entries:[],state:'EMPTY',containsExcluded:false,rawUnparsed:false,reviewed:false}));root.append(del);
    const exclude=document.createElement('button');exclude.textContent='配信対象外にする';exclude.onclick=()=>change(p=>putLesson(p,{...(getLesson(selection.day,selection.period)||cell),entries:[],state:'EXCLUDED',containsExcluded:false,rawUnparsed:false,reviewed:false}));root.append(exclude);
    if(cell.entries.length){const label=document.createElement('label');label.className='row';const check=document.createElement('input');check.type='checkbox';check.checked=Boolean(cell.containsExcluded);check.onchange=()=>change(p=>{const c=structuredClone(getLesson(selection.day,selection.period)||cell);c.containsExcluded=check.checked;c.reviewed=false;putLesson(p,c);});label.append(check,document.createTextNode('この枠に配信対象外の授業もある'));root.append(label);}
    reviewControl(root,saved?.reviewed||false,checked=>change(p=>{const c=structuredClone(getLesson(selection.day,selection.period)||cell);c.reviewed=checked;putLesson(p,c);}));
  }else{
    const saved=getDay(selection.date),cell=saved||{...emptyDay(selection.date),scope:$('scope').value,sourceId,sourcePage:page};sourceControls(root,cell,(key,value)=>change(p=>{const c=structuredClone(getDay(selection.date)||cell);c[key]=value;c.reviewed=false;p.calendar=p.calendar.filter(x=>!(x.scope===c.scope&&x.date===c.date));p.calendar.push(c);},false));const grid=document.createElement('div');grid.className='fields';
    const setDay=(key,v)=>change(p=>{const c=structuredClone(getDay(selection.date)||cell);c[key]=v;c.reviewed=false;p.calendar=p.calendar.filter(x=>!(x.scope===c.scope&&x.date===c.date));p.calendar.push(c);},false);
    choice(grid,'A/B・休日',cell.dayType,[['','指定なし'],['A','A'],['B','B'],['HOLIDAY','休日']],v=>setDay('dayType',v));choice(grid,'振替先の曜日',cell.lessonDay,[['','指定なし'],...weekday.map((name,i)=>[String(i+1),`${name}曜`])],v=>setDay('lessonDay',v));choice(grid,'振替先のA/B',cell.lessonType,[['','指定なし'],['A','A'],['B','B']],v=>setDay('lessonType',v));field(grid,'行事名',cell.label,v=>setDay('label',v));choice(grid,'行事の種類',cell.eventKind,[['','その他'],['MIDTERM','中間試験'],['FINAL','期末試験'],['EXCURSION','校外行事'],['EVENT','学校行事'],['EXAM_RETURN','試験返却']],v=>setDay('eventKind',v));root.append(grid);
    const del=document.createElement('button');del.textContent='この日を削除';del.onclick=()=>change(p=>{p.calendar=p.calendar.filter(c=>!(c.scope===cell.scope&&c.date===cell.date));});root.append(del);reviewControl(root,saved?.reviewed||false,checked=>change(p=>{const c=structuredClone(getDay(selection.date)||cell);c.reviewed=checked;p.calendar=p.calendar.filter(x=>!(x.scope===c.scope&&x.date===c.date));p.calendar.push(c);}));
  }
}
function reviewControl(root,checked,handler){const label=document.createElement('label');label.className='row';const box=document.createElement('input');box.type='checkbox';box.className='review';box.checked=checked;box.onchange=()=>handler(box.checked);label.append(box,document.createTextNode('確認済み'));root.append(label);}
function refresh(){renderTable();renderEditor();updateControls();}
$('lesson-tab').onclick=()=>{view='lesson';selection=null;$('bulk-status').textContent='';refresh();};$('calendar-tab').onclick=()=>{view='calendar';selection=null;$('bulk-status').textContent='';refresh();};
for(const id of ['term','class-id','scope'])$(id).onchange=()=>{
  if(id==='class-id'){const value=$('class-id').value.normalize('NFKC').trim().toUpperCase();if(!validClassId(value)){$('class-id').value=lastClassId;say('クラスを確認してください');return;}$('class-id').value=value;lastClassId=value;say('');}
  if(id!=='scope')invalidateCoverage();if(id==='term')restoreExportConfig(exportConfigForTerm(project(),$('term').value));selection=null;$('bulk-status').textContent='';refresh();
};
$('year').onchange=()=>{const year=Number($('year').value);if(year>=2000&&year<=2100)change(p=>{p.year=year;});};
$('period-count').onchange=()=>{const count=Number($('period-count').value),minimum=project().lessons.reduce((max,c)=>Math.max(max,c.period),1);if(!Number.isInteger(count)||count<minimum||count>12){$('period-count').value=periodCount(project());say(`時限数は${minimum}〜12で指定してください`);return;}change(p=>{p.periodCount=count;});say('');};
$('add-week').onclick=()=>{if(!$('week').value)return;const week=mondayOf($('week').value),scope=$('scope').value;change(p=>{for(let i=0;i<5;i++){const date=dateAdd(week,i);if(!p.calendar.some(c=>c.date===date&&c.scope===scope))p.calendar.push({...emptyDay(date),scope,sourceId,sourcePage:page});}});};
$('add-range').onclick=()=>{try{const useSource=$('range-source').checked;if(useSource&&!pdf)throw Error('参照するPDFを表示してください');const cells=missingCalendarRange(project(),$('scope').value,$('range-start').value,$('range-end').value,useSource?sourceId:'',useSource?page:null);if(!cells.length){say('追加する日付はありません');return;}change(p=>p.calendar.push(...cells));say(`${cells.length}日を追加しました`);}catch(error){say(error.message||'期間を追加できませんでした');}};
function bulkReview(reviewed){
  try{
    const range=view==='lesson'?{kind:'lesson',term:$('term').value,classId:$('class-id').value,firstDay:Number($('bulk-first-day').value),lastDay:Number($('bulk-last-day').value),firstPeriod:Number($('bulk-first-period').value),lastPeriod:Number($('bulk-last-period').value)}:{kind:'calendar',scope:$('scope').value,start:$('bulk-start').value,end:$('bulk-end').value};
    const plan=planReviewRange(project(),range,reviewed,sourcePageCounts);
    if(plan.stats.changed)change(p=>applyReviewPlan(p,plan));
    const {changed,unchanged,missing,problems}=plan.stats;
    $('bulk-status').textContent=`${changed}件を${reviewed?'確認済み':'未確認'}にしました${unchanged?` · 変更なし ${unchanged}件`:''}${missing?` · 未入力 ${missing}件`:''}${problems?` · 要修正 ${problems}件`:''}`;
  }catch(error){$('bulk-status').textContent=error.message||'範囲を確認してください';}
}
$('bulk-confirm').onclick=()=>bulkReview(true);$('bulk-unconfirm').onclick=()=>bulkReview(false);
$('prev').onclick=()=>{page--;renderPdf().catch(e=>say(e.message));};$('next').onclick=()=>{page++;renderPdf().catch(e=>say(e.message));};$('zoom-in').onclick=()=>{zoom=Math.min(3,zoom+.25);renderPdf().catch(e=>say(e.message));};$('zoom-out').onclick=()=>{zoom=Math.max(.5,zoom-.25);renderPdf().catch(e=>say(e.message));};
$('table-zoom-in').onclick=()=>{tableZoom=Math.min(1.6,tableZoom+.1);renderTable();};$('table-zoom-out').onclick=()=>{tableZoom=Math.max(.7,tableZoom-.1);renderTable();};
function historyFocus(){
  const active=document.activeElement;if(active?.matches('.slot.selected'))return {slot:true};
  if(!$('editor').contains(active)||!active.dataset.historyField)return null;
  return {field:active.dataset.historyField,entry:active.closest('.entry')?.dataset.historyEntry,
    unstored:selection?.kind==='lesson'&&!getLesson(selection.day,selection.period),start:active.selectionStart,end:active.selectionEnd};
}
function restoreHistoryFocus(focus){
  if(!focus)return;
  const selected=document.querySelector('.slot.selected');if(focus.slot){selected?.focus({preventScroll:true});return;}
  const fields=[...$('editor').querySelectorAll('[data-history-field]')];
  let target=fields.find(item=>item.dataset.historyField===focus.field&&item.closest('.entry')?.dataset.historyEntry===focus.entry);
  if(!target&&focus.entry&&selection?.kind==='lesson'&&(focus.unstored||!getLesson(selection.day,selection.period)))
    target=fields.find(item=>item.dataset.historyField===focus.field&&item.closest('.entry'));
  if(!target){selected?.focus({preventScroll:true});return;}
  target.focus({preventScroll:true});if(Number.isInteger(focus.start)&&typeof target.setSelectionRange==='function')target.setSelectionRange(focus.start,focus.end);
}
function moveHistory(action){
  const focus=historyFocus();if(!history[action]())return;
  dirty=true;$('bulk-status').textContent='';restoreExportConfig(exportConfigForTerm(project(),$('term').value));refresh();
  if(selection&&!document.querySelector('.slot.selected')){selection=null;renderEditor();}
  restoreHistoryFocus(focus);
  if(!project().sources.some(s=>s.id===sourceId))showSource(project().sources[0]?.id).catch(e=>say(e.message));
  say(action==='undo'?'元に戻しました':'やり直しました');
}
$('undo').onclick=()=>moveHistory('undo');$('redo').onclick=()=>moveHistory('redo');
$('source').onchange=()=>showSource($('source').value).catch(e=>{updateControls();say(e.message);});
$('next-issue').onclick=()=>{const current=selection&&(selection.kind==='lesson'?{...selection,term:$('term').value,classId:$('class-id').value}:{...selection,scope:$('scope').value});const item=nextReviewItem(project(),current,sourcePageCounts);if(!item)return;invalidateCoverage();if(item.kind==='lesson'){view='lesson';$('term').value=item.c.term;restoreExportConfig(exportConfigForTerm(project(),item.c.term));$('class-id').value=item.c.classId;lastClassId=item.c.classId;selection={kind:'lesson',day:item.c.day,period:item.c.period};}else{view='calendar';$('scope').value=item.c.scope;selection={kind:'calendar',date:item.c.date};}refresh();showSelectedEditor();document.querySelector('.slot.selected')?.scrollIntoView({block:'nearest'});};
$('next-missing').onclick=()=>{const missing=visibleMissing();if(!missing.length)return;const index=missing.findIndex(sameSelection);selection=missing[(index+1)%missing.length];refresh();showSelectedEditor();document.querySelector('.slot.selected')?.scrollIntoView({block:'nearest'});};
function canReplace(){return !dirty||confirm('保存していない変更があります。別のファイルを開きますか？');}
$('pdf-input').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  const activeHistory=history,request=++sourceRequest,termAtStart=$('term').value;
  const year=project().sources.length?project().year:Number($('year').value);
  const term=file.name.includes('後期')?'F':file.name.includes('前期')?'S':termAtStart;
  let doc=null,committed=false;
  try{
    const bytes=new Uint8Array(await file.arrayBuffer());doc=await pdfjs.getDocument({data:bytes.slice()}).promise;
    const source={id:crypto.randomUUID(),name:file.name,data:to64(bytes),sha256:await sha256(bytes)},lessons=[],calendar=[],warnings=[];
    for(let n=1;n<=doc.numPages;n++){try{const p=await doc.getPage(n),v=p.getViewport({scale:1}),text=await p.getTextContent(),found=extractPage(text.items,v.width,v.height,year,term,n);lessons.push(...found.lessons.map(c=>({...c,sourcePage:n})));calendar.push(...found.calendar.map(c=>({...c,sourcePage:n})));warnings.push(...found.warnings);}catch{warnings.push(`ページ${n}: 抽出できませんでした`);}}
    if(history!==activeHistory||(project().sources.length?project().year:Number($('year').value))!==year)throw Error('作業が切り替わりました。もう一度PDFを追加してください');
    const base=structuredClone(project());if(!base.sources.length){base.year=year;base.term=term;}
    const merged=addSourcePreservingEdits(base,source,lessons,calendar),next=merged.project;
    if(merged.skippedLessons||merged.skippedDays)warnings.push(`既存の${merged.skippedLessons+merged.skippedDays}枠はそのまま残しました。PDFと内容を確認してください`);
    (next.warnings??=[]).push(...warnings.map(message=>({sourceId:source.id,message,...(/^ページ\d+: 2年生以上の(?:時間割は手入力してください|抽出結果を確認してください)$/.test(message)?{term,excludedClassIds:['1-1','1-2','1-3','1-4']}:{})})));if(next.exportConfig)next.exportConfig['coverage-confirmed']='false';
    if(!validProject(next))throw Error('解析結果を読み込めませんでした');
    history.change(p=>Object.assign(p,next));sourcePageCounts.set(source.id,doc.numPages);committed=true;$('coverage-confirmed').checked=false;dirty=true;
    if(request===sourceRequest){
      pdf=doc;sourceId=source.id;page=1;selection=null;
      if($('term').value===termAtStart){$('term').value=term;restoreExportConfig(exportConfigForTerm(project(),term));}
      if(calendar.length){view='calendar';$('scope').value=calendar[0].scope;}else view='lesson';
      refresh();await renderPdf();
    }else{await doc.destroy().catch(()=>{});refresh();}
    if(history===activeHistory)say(warnings.join('\n')||'抽出した内容を確認してください');
  }catch(error){if(doc&&!committed)await doc.destroy().catch(()=>{});say(committed?'PDFを追加しましたが、表示できませんでした':`PDFを追加できませんでした: ${error.message}`);}
};
$('project-input').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file||!canReplace())return;
  const captured=captureHistory(history),docs=[];let committed=false;
  try{
    let next=JSON.parse(await file.text());if(next.version===1&&isProjectShape(next))next=migrateV1(next,Number($('year').value),$('term').value);else if(next.version===2)next=migrateV2(next);
    if(!validProject(next))throw Error('形式が正しくありません');
    for(const source of next.sources){const bytes=from64(source.data),actual=await sha256(bytes);if(source.sha256&&source.sha256!==actual)throw Error('PDFが破損しています');source.sha256=actual;docs.push(await pdfjs.getDocument({data:bytes}).promise);}
    const migrated=ensureEntryIds(next);
    if(!historyUnchanged(history,captured))throw Error('読み込み中に変更されました。保存してからもう一度開いてください');
    const request=++sourceRequest;renderToken++;history=new History(next);sourcePageCounts=new Map(next.sources.map((source,index)=>[source.id,docs[index].numPages]));const loadedHistory=history;committed=true;
    const initial=initialProjectView(next,$('class-id').value),sourceIndex=next.sources.findIndex(source=>source.id===initial.sourceId);
    pdf=docs[sourceIndex];sourceId=initial.sourceId;page=initial.page<=pdf.numPages?initial.page:1;view=initial.view;dirty=migrated;selection=null;$('year').value=next.year;$('term').value=initial.term;$('class-id').value=initial.classId;lastClassId=initial.classId;
    const config=exportConfigForTerm(next,initial.term);restoreExportConfig(config);$('bulk-start').value=config['export-start']||'';$('bulk-end').value=config['export-end']||'';$('bulk-status').textContent='';
    if(initial.scope){$('scope').value=initial.scope;if(!$('export-scope').value)$('export-scope').value=initial.scope;}
    refresh();docs.forEach((doc,index)=>{if(index!==sourceIndex)doc.destroy().catch(()=>{});});await renderPdf();if(history===loadedHistory&&sourceRequest===request)say('作業を開きました');
  }catch(error){if(!committed)for(const doc of docs)await doc.destroy().catch(()=>{});say(committed?'作業を開きましたが、PDFを表示できませんでした':`作業ファイルを開けませんでした: ${error.message}`);}
};
$('save').onclick=async()=>{
  if(saving)return;
  if(!project().sources.length){say('PDFを追加してください');return;}
  const filename=`${project().year}年度.sktjf-project.json`,data=JSON.stringify(project()),savedHistory=history;
  if(window.showSaveFilePicker){
    saving=true;$('save').disabled=true;
    try{
      const handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'作業ファイル',accept:{'application/json':['.json']}}]});
      const writable=await handle.createWritable();await writable.write(data);await writable.close();
      if(history===savedHistory){dirty=!matchesSavedSnapshot(project(),data);say(dirty?'保存後の変更があります':'作業ファイルを保存しました');}
    }catch(error){if(history===savedHistory&&error.name!=='AbortError')say('作業ファイルを保存できませんでした');}
    finally{saving=false;$('save').disabled=false;}
    return;
  }
  const url=URL.createObjectURL(new Blob([data],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);say('ダウンロードを開始しました');
};
$('export').onclick=async()=>{const term=$('term').value,revision=`${project().year}.${term}.${$('export-revision').value}`,periods=Array.from({length:periodCount(project())},(_,i)=>({number:i+1,start:$(`period-${i+1}-start`).value,end:$(`period-${i+1}-end`).value}));$('export-status').textContent='確認しています…';try{const response=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:project(),options:{term,classId:$('class-id').value,scope:$('export-scope').value,start:$('export-start').value,end:$('export-end').value,revision,periods,coverageConfirmed:$('coverage-confirmed').checked}})}),result=await response.json();if(!response.ok)throw Error(result.error);const blob=new Blob([JSON.stringify(result.data,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${result.data.classId}.sktjf.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('export-status').textContent='ダウンロードを開始しました';}catch(error){$('export-status').textContent=error.message||'書き出せませんでした';}};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('copy',e=>{if(!selection||!e.target.matches('.slot.selected'))return;const cell=selection.kind==='lesson'?getLesson(selection.day,selection.period):getDay(selection.date);if(cell){e.clipboardData.setData('text/plain',JSON.stringify({format:'sktjf-table-cell',kind:selection.kind,cell}));e.preventDefault();}});
window.addEventListener('paste',e=>{if(!selection||!e.target.matches('.slot.selected'))return;try{const data=JSON.parse(e.clipboardData.getData('text/plain')),destination=selection.kind==='lesson'?{...selection,term:$('term').value,classId:$('class-id').value}:{...selection,scope:$('scope').value};let result;change(p=>{result=pasteTableCell(p,data,destination);});document.querySelector('.slot.selected')?.focus({preventScroll:true});if(result.sourceMissing)say('参照するPDFを選択してください');else say('');e.preventDefault();}catch{say('コピーしたセルを貼り付けてください');}});
window.addEventListener('keydown',e=>{
  if(e.isComposing)return;
  const mod=e.ctrlKey||e.metaKey,editable=e.target.matches('input,textarea,select');
  const historyOwned=!editable||Boolean(e.target.closest('#editor'))||exportFields.includes(e.target.id)||e.target.id==='coverage-confirmed';
  if(mod&&historyOwned&&e.key.toLowerCase()==='z'){e.preventDefault();(e.shiftKey?$('redo'):$('undo')).click();}
  else if(mod&&historyOwned&&e.key.toLowerCase()==='y'){e.preventDefault();$('redo').click();}
  else if(!editable&&selection&&e.target.matches('.slot.selected')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();selection=adjacentVisibleSlot(project(),selection,$('scope').value,e.key);refresh();showSelectedEditor();document.querySelector('.slot.selected')?.focus();}
});
refresh();
