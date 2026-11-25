export const classIds = ['1-1','1-2','1-3','1-4', ...[2,3,4,5].flatMap(y => ['M','E','I','B'].map(c => `${y}${c}`))];
export const validClassId = value => /^(1-[1-4]|[2-5][MEIB]|AC-[A-Z0-9]+)$/.test(value);
export const isUndergraduateScope = scope => !scope.normalize('NFKC').trim().toUpperCase().startsWith('AC-');
export function validWarningScope(value) {
  if(typeof value!=='string')return false;
  const normalized=value.normalize('NFKC').replace(/\s/g,'');
  return validClassId(normalized)||/^(1[・･]2[・･]3年生|4[・･]5年生|[45](ME|IB))$/.test(normalized);
}
export const emptyLesson = () => ({ id:crypto.randomUUID(), subject:'', teacher:'', room:'', cycle:'', attributes:'', excludedAttributes:'', remote:'', special:'' });
export const emptyDay = date => ({ date, dayType:'', lessonDay:'', lessonType:'', label:'', reviewed:false, raw:'' });
/** Week numbers have their own source and confirmation, separate from A/B dates. */
export function putWeekDay(project, day) {
  project.weekCalendar=(project.weekCalendar||[]).filter(item=>!(item.scope===day.scope&&item.date===day.date));
  project.weekCalendar.push(day);
}

/** Group only lessons explicitly selected by the editor; adjacent periods are never inferred. */
export function putWeekSeries(project, {term,classId,dayOfWeek,lessonIds,cycle,id=crypto.randomUUID()}) {
  if(!['S','F'].includes(term)||!validClassId(classId)||!Number.isInteger(dayOfWeek)||dayOfWeek<1||dayOfWeek>5||
      typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)||
      !Array.isArray(lessonIds)||!lessonIds.length||lessonIds.length>1000||new Set(lessonIds).size!==lessonIds.length||
      !lessonIds.every(value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))||!['WEEKLY','A','B'].includes(cycle))throw Error('授業を確認してください');
  const entries=project.lessons.filter(cell=>cell.term===term&&cell.classId===classId&&cell.day===dayOfWeek)
    .flatMap(cell=>cell.entries.map(entry=>({cell,entry}))).filter(item=>lessonIds.includes(item.entry.id));
  if(entries.length!==lessonIds.length||!entries.some(({entry})=>entry.weekStart||entry.weekEnd))throw Error('実施週のある授業を選択してください');
  if(entries.some(({entry})=>cycle!=='WEEKLY'&&entry.cycle&&entry.cycle!=='WEEKLY'&&entry.cycle!==cycle))throw Error('A/Bを確認してください');
  if((project.weekSeries||[]).some(series=>series.term===term&&series.classId===classId&&series.id!==id&&series.lessonIds.some(value=>lessonIds.includes(value))))throw Error('選択した授業は別の授業機会に含まれています');
  const sources=[];
  for(const {cell} of entries){
    if(!cell.sourceId||!Number.isInteger(cell.sourcePage)||cell.sourcePage<1||!project.sources.some(source=>source.id===cell.sourceId))throw Error('参照するPDFとページを確認してください');
    if(!sources.some(source=>source.sourceId===cell.sourceId&&source.page===cell.sourcePage))sources.push({sourceId:cell.sourceId,page:cell.sourcePage});
  }
  const existing=(project.weekSeries||[]).find(item=>item.term===term&&item.classId===classId&&item.id===id);
  const periods=[...new Set(entries.map(({cell})=>cell.period))].sort((a,b)=>a-b);
  if(existing?.countingPolicy?.officialPeriodOverrides?.some(item=>!periods.includes(item.period)))throw Error('数え方に含まれる時限を残してください');
  const series={term,classId,id,dayOfWeek,periods,lessonIds:[...lessonIds],cycle,sources,reviewed:false,
    ...(existing?.countingPolicy!==undefined?{countingPolicy:structuredClone(existing.countingPolicy)}:{})};
  project.weekSeries=(project.weekSeries||[]).filter(item=>!(item.term===term&&item.classId===classId&&item.id===id));
  project.weekSeries.push(series);return series;
}
export function weekDayProblems(project, day, pageCounts = new Map()) {
  const problems=[];
  if(!/^[1-9][0-9]{0,2}$/.test(day.week||''))problems.push('授業週を確認してください');
  if(!day.sourceId||!project.sources.some(source=>source.id===day.sourceId)||!Number.isInteger(day.sourcePage)||day.sourcePage<1||
    (pageCounts.has(day.sourceId)&&day.sourcePage>pageCounts.get(day.sourceId)))problems.push('授業週の参照PDFとページを確認してください');
  return problems;
}
// A save may finish after the user has made more edits. Only the exact saved snapshot is clean.
export const matchesSavedSnapshot = (project, savedJson) => JSON.stringify(project) === savedJson;
export const periodCount = project => project.lessons.reduce((max,c)=>Math.max(max,c.period),project.periodCount ?? 4);
export function emptyProject(pdf, pdfName, year, term) {
  return {version:3,sources:pdf?[{id:'legacy',name:pdfName,data:pdf,sha256:''}]:[],year,term,lessons:[],calendar:[],legacyCells:[],warnings:[]};
}
/** Open on an existing lesson and its source, or a calendar when no lessons exist. */
export function initialProjectView(project, preferredClass) {
  const supported=project.lessons.filter(cell=>classIds.includes(cell.classId));
  const sameTerm=supported.filter(cell=>cell.term===project.term);
  const lessons=sameTerm.length?sameTerm:supported;
  const first=lessons.find(cell=>cell.classId===preferredClass)||lessons[0];
  const calendar=project.calendar.find(cell=>isUndergraduateScope(cell.scope));
  const source=first||calendar;
  return {view:first?'lesson':calendar?'calendar':'lesson',term:first?.term||project.term,
    classId:first?.classId||preferredClass,scope:calendar?.scope||'',
    sourceId:project.sources.some(item=>item.id===source?.sourceId)?source.sourceId:project.sources[0].id,
    page:source?.sourcePage||1};
}
export function lessonAt(project, term, classId, day, period) {
  return project.lessons.find(c=>c.term===term && c.classId===classId && c.day===day && c.period===period);
}
export function putLesson(project, cell) {
  const previous=lessonAt(project,cell.term,cell.classId,cell.day,cell.period);
  const relevant=entry=>entry&&JSON.stringify([entry.id,entry.subject,entry.cycle,entry.attributes,entry.excludedAttributes,entry.weekStart,entry.weekEnd,entry.weekSourceNotation]);
  for(const series of project.weekSeries||[]){
    if(series.term!==cell.term||series.classId!==cell.classId||series.dayOfWeek!==cell.day)continue;
    const changed=series.lessonIds.some(id=>relevant(previous?.entries.find(entry=>entry.id===id))!==relevant(cell.entries.find(entry=>entry.id===id)));
    if(changed||(previous&&(previous.sourceId!==cell.sourceId||previous.sourcePage!==cell.sourcePage)&&cell.entries.some(entry=>series.lessonIds.includes(entry.id))))series.reviewed=false;
  }
  project.lessons=project.lessons.filter(c=>!(c.term===cell.term && c.classId===cell.classId && c.day===cell.day && c.period===cell.period));
  project.lessons.push(cell);
}
export function isoDate(year, month, day) {
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day ? date.toISOString().slice(0,10) : null;
}
export function dateAdd(date, days) { const d=new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
export function mondayOf(date) { const d=new Date(`${date}T00:00:00Z`); return dateAdd(date,-((d.getUTCDay()+6)%7)); }
/** Missing positions in the currently visible table; never create or confirm records. */
export function missingSlots(project, view, term, classId, scope) {
  if(view==='lesson'){
    const result=[];
    for(let period=1;period<=periodCount(project);period++)for(let day=1;day<=5;day++)
      if(!lessonAt(project,term,classId,day,period))result.push({kind:'lesson',day,period});
    return result;
  }
  const dates=new Set(project.calendar.filter(c=>c.scope===scope).map(c=>c.date));
  const weeks=[...new Set([...dates].map(mondayOf))].sort(),result=[];
  for(const week of weeks)for(let day=0;day<5;day++){
    const date=dateAdd(week,day);if(!dates.has(date))result.push({kind:'calendar',date});
  }
  return result;
}

/** Local, actionable checks complement the full export validator. */
export function cellProblems(project, kind, cell, pageCounts = new Map()) {
  if(!cell)return [];
  const problems=[];
  if(!cell.sourceId||!project.sources.some(source=>source.id===cell.sourceId)||!Number.isInteger(cell.sourcePage)||cell.sourcePage<1)
    problems.push('参照するPDFとページを指定してください');
  else if(pageCounts.has(cell.sourceId)&&cell.sourcePage>pageCounts.get(cell.sourceId))
    problems.push('参照ページを確認してください');
  if(kind==='lesson'){
    const entries=cell.entries||[],state=cell.state||(!entries.length?'EMPTY':'PRESENT');
    if((project.weekSeries||[]).some(series=>series.term===cell.term&&series.classId===cell.classId&&series.dayOfWeek===cell.day&&
      !series.reviewed&&series.lessonIds.some(id=>entries.some(entry=>entry.id===id))))problems.push('授業機会の関連付けを確認してください');
    if(cell.rawUnparsed)problems.push('科目・教員・教室を確認してください');
    if(!['PRESENT','EMPTY','EXCLUDED'].includes(state)||(state==='PRESENT')!==Boolean(entries.length)||(state==='EMPTY'&&cell.containsExcluded))
      problems.push('枠の内容を確認してください');
    if(/※\s*[3３]/.test(cell.raw||'')&&state!=='EXCLUDED'&&!cell.containsExcluded)
      problems.push('配信対象外の授業を確認してください');
    entries.forEach((entry,index)=>{
      const label=entries.length>1?`授業${index+1}: `:'';
      const subject=(entry.subject||'').trim(),cycle=(entry.cycle||'').trim().toUpperCase();
      const all=(entry.attributes||'').split(/[,，\s]+/).filter(Boolean),none=(entry.excludedAttributes||'').split(/[,，\s]+/).filter(Boolean);
      const special=(entry.special||'').trim().toUpperCase(),remote=entry.remote||'';
      const first=entry.weekStart||'',last=entry.weekEnd||'';
      if((first&&!/^[1-9][0-9]{0,2}$/.test(first))||(last&&!/^[1-9][0-9]{0,2}$/.test(last))||(first&&last&&Number(first)>Number(last)))
        problems.push(`${label}実施週の範囲を確認してください`);
      if(!subject)problems.push(`${label}科目名を入力してください`);
      if(subject===(cell.raw||'').trim()&&/^[AB]\s*(?=[^\x00-\x7f])/u.test(subject))
        problems.push(`${label}A/Bと科目名を確認してください`);
      if(cycle&&!['A','B','WEEKLY'].includes(cycle))problems.push(`${label}授業の週を確認してください`);
      if(![...all,...none].every(value=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value))||all.some(value=>none.includes(value))||new Set(all).size!==all.length||new Set(none).size!==none.length)
        problems.push(`${label}対象学生の属性を確認してください`);
      if(!['','yes','no'].includes(remote))problems.push(`${label}授業形式を確認してください`);
      if(!['','NORMAL','MAKEUP','EXTENSION'].includes(special)||(special==='MAKEUP'&&subject!=='補講')||(special==='EXTENSION'&&subject!=='延長枠'&&!/^※\s*[2２]$/.test(subject)))
        problems.push(`${label}授業の種類を確認してください`);
      if(/※\s*[3３]/.test(subject)||(/※\s*[2２]/.test(subject)&&!/^※\s*[2２]$/.test(subject)))
        problems.push(`${label}脚注を確認してください`);
    });
  }else if(kind==='calendar'){
    const type=(cell.dayType||'').trim().toUpperCase(),day=cell.lessonDay||'',override=cell.lessonType||'',label=(cell.label||'').trim();
    if(!['','A','B','HOLIDAY','休日','祝日'].includes(type)||(!type&&!label))problems.push('A/B・休日または行事を入力してください');
    else if(!type&&!['MIDTERM','FINAL'].includes(cell.eventKind))problems.push('行事の日はA/Bまたは休日を選んでください');
    if((day&&!['1','2','3','4','5','6','7'].includes(day))||(override&&!['A','B'].includes(override))||(override&&!day))problems.push('振替先を確認してください');
    if(['HOLIDAY','休日','祝日'].includes(type)&&(day||override))problems.push('休日の振替先を確認してください');
    if(cell.eventKind&&!['MIDTERM','FINAL','EXCURSION','EVENT','EXAM_RETURN','OTHER'].includes(cell.eventKind))problems.push('行事の種類を確認してください');
    if(cell.eventKind&&!label)problems.push('行事名を入力してください');
    if((cell.eventSourceId||cell.eventSourcePage)&&(!project.sources.some(source=>source.id===cell.eventSourceId)||
      !Number.isInteger(cell.eventSourcePage)||cell.eventSourcePage<1||
      (pageCounts.has(cell.eventSourceId)&&cell.eventSourcePage>pageCounts.get(cell.eventSourceId))))problems.push('行事の参照PDFとページを確認してください');
  }
  return problems;
}

export function reviewItems(project, pageCounts = new Map()) {
  return [...project.lessons.filter(c=>classIds.includes(c.classId)).map(c=>({kind:'lesson',c})),
    ...project.calendar.filter(c=>isUndergraduateScope(c.scope)).map(c=>({kind:'calendar',c}))]
    .filter(item=>!item.c.reviewed||cellProblems(project,item.kind,item.c,pageCounts).length);
}

export function isStandaloneDdLesson(cell) {
  return Boolean(cell?.entries?.length) && cell.entries.every(entry =>
    (entry.attributes || '').split(/[,，\s]+/).includes('DD'));
}

/** Prepare an explicit range without creating missing cells or confirming invalid ones. */
export function planReviewRange(project, range, reviewed, pageCounts = new Map()) {
  if(typeof reviewed!=='boolean'||!range||!['lesson','calendar'].includes(range.kind))throw new Error('確認する範囲を指定してください');
  const targets=[],stats={changed:0,unchanged:0,missing:0,problems:0,individual:0};
  const add=(cell,key,required=true)=>{
    if(!cell){if(required)stats.missing++;return;}
    if(reviewed&&cellProblems(project,range.kind,cell,pageCounts).length){stats.problems++;return;}
    if(cell.reviewed===reviewed){stats.unchanged++;return;}
    if(reviewed&&range.kind==='lesson'&&isStandaloneDdLesson(cell)){stats.individual++;return;}
    targets.push(key);stats.changed++;
  };
  if(range.kind==='lesson'){
    const {term,classId,firstDay,lastDay,firstPeriod,lastPeriod}=range;
    if(!['S','F'].includes(term)||!classIds.includes(classId)||![firstDay,lastDay,firstPeriod,lastPeriod].every(Number.isInteger)||
      firstDay<1||lastDay>5||firstDay>lastDay||firstPeriod<1||lastPeriod>periodCount(project)||firstPeriod>lastPeriod)
      throw new Error('曜日と時限の範囲を確認してください');
    for(let period=firstPeriod;period<=lastPeriod;period++)for(let day=firstDay;day<=lastDay;day++)
      add(lessonAt(project,term,classId,day,period),{term,classId,day,period});
  }else{
    const {scope,start,end}=range,validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&isoDate(...value.split('-').map(Number))===value;
    if(typeof scope!=='string'||!scope.trim()||!isUndergraduateScope(scope)||!validDate(start)||!validDate(end)||start>end||start<`${project.year}-04-01`||end>`${project.year+1}-03-31`)
      throw new Error('年度内の日付の範囲を確認してください');
    const days=new Map(project.calendar.filter(c=>c.scope===scope).map(c=>[c.date,c]));
    for(let date=start;date<=end;date=dateAdd(date,1)){
      const day=new Date(`${date}T00:00:00Z`).getUTCDay();
      add(days.get(date),{scope,date},day>=1&&day<=5);
    }
  }
  return {kind:range.kind,reviewed,targets,stats};
}
export function applyReviewPlan(project,plan) {
  for(const key of plan.targets){
    const cell=plan.kind==='lesson'?lessonAt(project,key.term,key.classId,key.day,key.period):project.calendar.find(c=>c.scope===key.scope&&c.date===key.date);
    if(!cell)throw new Error('確認する範囲が変わりました');
    cell.reviewed=plan.reviewed;
  }
}

// Keep the traversal order independent of edits, which can reorder records in the project.
function reviewPosition(kind, cell) {
  return kind==='lesson'
    ? [0,cell.term==='S'?0:1,cell.classId,cell.period,cell.day]
    : [1,cell.scope,cell.date];
}
function compareReviewPosition(a,b) {
  for(let i=0;i<Math.max(a.length,b.length);i++){
    if(a[i]<b[i])return -1;
    if(a[i]>b[i])return 1;
  }
  return 0;
}
/** Find the next issue even if the current cell was just confirmed or removed. */
export function nextReviewItem(project, current, pageCounts = new Map()) {
  const items=reviewItems(project,pageCounts).sort((a,b)=>compareReviewPosition(reviewPosition(a.kind,a.c),reviewPosition(b.kind,b.c)));
  if(!items.length)return null;
  if(!current)return items[0];
  const position=reviewPosition(current.kind,current);
  return items.find(item=>compareReviewPosition(reviewPosition(item.kind,item.c),position)>0)||items[0];
}
/** Prepare missing weekdays for manual review without changing existing calendar records. */
export function missingCalendarRange(project, scope, start, end, sourceId = '', sourcePage = null) {
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&isoDate(...value.split('-').map(Number))===value;
  if(typeof scope!=='string'||!scope.trim())throw new Error('隔週表の対象を入力してください');
  if(!validDate(start)||!validDate(end)||start>end||start<`${project.year}-04-01`||end>`${project.year+1}-03-31`)
    throw new Error('年度内の期間を指定してください');
  if(sourceId&&(!project.sources.some(source=>source.id===sourceId)||!Number.isInteger(sourcePage)||sourcePage<1))
    throw new Error('参照するPDFとページを確認してください');
  const existing=new Set(project.calendar.filter(cell=>cell.scope===scope).map(cell=>cell.date)),result=[];
  for(let date=start;date<=end;date=dateAdd(date,1)){
    const weekday=new Date(`${date}T00:00:00Z`).getUTCDay();
    if(weekday>=1&&weekday<=5&&!existing.has(date))
      result.push({...emptyDay(date),scope,sourceId:sourceId||'',sourcePage:sourceId?sourcePage:null});
  }
  return result;
}

/** Move only to cells actually displayed in the current table. */
export function adjacentVisibleSlot(project, selection, scope, direction) {
  if (!selection || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(direction)) return selection;
  if (selection.kind === 'lesson') {
    const day=selection.day+(direction==='ArrowRight'?1:direction==='ArrowLeft'?-1:0);
    const period=selection.period+(direction==='ArrowDown'?1:direction==='ArrowUp'?-1:0);
    return day>=1&&day<=5&&period>=1&&period<=periodCount(project)?{...selection,day,period}:selection;
  }
  if (selection.kind !== 'calendar') return selection;
  const dates=new Set(project.calendar.filter(c=>c.scope===scope).map(c=>c.date));
  const weeks=new Set([...dates].map(mondayOf));
  const delta=direction==='ArrowRight'?1:direction==='ArrowLeft'?-1:direction==='ArrowDown'?7:-7;
  const date=dateAdd(selection.date,delta),week=mondayOf(date),horizontal=direction==='ArrowLeft'||direction==='ArrowRight';
  return weeks.has(week)&&(!horizontal||week===mondayOf(selection.date))?{...selection,date}:selection;
}

export function migrateV1(project, year = 2026, term = 'S') {
  // The old overlay often lacks class/day/period. Preserve it without assigning it to guessed slots.
  return {...emptyProject(project.pdf,project.pdfName,year,term),legacyCells:structuredClone(project.cells)};
}
export function migrateV2(project) {
  const result=emptyProject(project.pdf,project.pdfName,project.year,project.term);
  result.lessons=project.lessons.map(c=>({...c,sourceId:'legacy'}));
  result.calendar=project.calendar.map(c=>({...c,sourceId:'legacy'}));
  result.legacyCells=structuredClone(project.legacyCells);
  return result;
}
export function ensureEntryIds(project) {
  let changed=false;for(const cell of project.lessons)for(const entry of cell.entries)if(!entry.id){entry.id=crypto.randomUUID();changed=true;}return changed;
}
/** Add a source only if none of its inferred records would overwrite existing work. */
export function addSource(project, source, lessons, calendar) {
  if(project.sources.some(s=>s.id===source.id || (source.sha256 && s.sha256===source.sha256))) throw new Error('このPDFは追加済みです');
  if(lessons.some(c=>lessonAt(project,c.term,c.classId,c.day,c.period)) || calendar.some(c=>project.calendar.some(d=>d.scope===c.scope&&d.date===c.date))) throw new Error('同じ枠のデータがあります。既存の内容を確認してください');
  const result=structuredClone(project);
  result.sources.push(structuredClone(source));
  result.lessons.push(...lessons.map(c=>({...structuredClone(c),sourceId:source.id})));
  result.calendar.push(...calendar.map(c=>({...structuredClone(c),sourceId:source.id})));
  return result;
}
/** Add the PDF and only previously empty positions, without replacing existing work. */
export function addSourcePreservingEdits(project, source, lessons, calendar) {
  if(project.sources.some(s=>s.id===source.id || (source.sha256 && s.sha256===source.sha256))) throw new Error('このPDFは追加済みです');
  const result=structuredClone(project), lessonKeys=new Set(result.lessons.map(c=>JSON.stringify([c.term,c.classId,c.day,c.period]))),
    dayKeys=new Set(result.calendar.map(c=>JSON.stringify([c.scope,c.date])));
  let skippedLessons=0,skippedDays=0;
  result.sources.push(structuredClone(source));
  for(const cell of lessons){const key=JSON.stringify([cell.term,cell.classId,cell.day,cell.period]);
    if(lessonKeys.has(key)){skippedLessons++;continue;}lessonKeys.add(key);result.lessons.push({...structuredClone(cell),sourceId:source.id});}
  for(const cell of calendar){const key=JSON.stringify([cell.scope,cell.date]);
    if(dayKeys.has(key)){skippedDays++;continue;}dayKeys.add(key);result.calendar.push({...structuredClone(cell),sourceId:source.id});}
  return {project:result,skippedLessons,skippedDays};
}

/** Keep each term's export dates separate, including projects saved before term-specific settings. */
export function exportConfigForTerm(project, term) {
  const saved = project.exportConfigs?.[term];
  if (saved) return saved;
  const legacy = project.exportConfig || {};
  if ((legacy.term || project.term) === term) return legacy;
  return {...legacy, term, 'export-start':'', 'export-end':'', 'coverage-confirmed':'false'};
}
export function setExportConfigForTerm(project, term, config) {
  const previous = project.exportConfig;
  const configs = {...project.exportConfigs};
  if (previous && !configs[previous.term || project.term]) configs[previous.term || project.term] = previous;
  configs[term] = {...config, term};
  project.exportConfigs = configs;
  project.exportConfig = configs[term];
}
export function validProject(p) {
  if (!p || p.version!==3 || !Array.isArray(p.sources) || !p.sources.length || !Number.isInteger(p.year) || p.year<2000 || p.year>2100 || !['S','F'].includes(p.term) || !Array.isArray(p.lessons) || !Array.isArray(p.calendar) || !Array.isArray(p.legacyCells)) return false;
  if(p.periodCount!==undefined&&(!Number.isInteger(p.periodCount)||p.periodCount<1||p.periodCount>12))return false;
  const sourceIds=new Set();if(!p.sources.every(s=>{if(!s||typeof s.id!=='string'||!s.id||sourceIds.has(s.id)||typeof s.name!=='string'||typeof s.data!=='string'||!s.data||typeof s.sha256!=='string'||(s.sha256!==''&&!/^[a-f0-9]{64}$/.test(s.sha256)))return false;sourceIds.add(s.id);return true;}))return false;
  if(p.warnings!==undefined&&(!Array.isArray(p.warnings)||!p.warnings.every(w=>w&&sourceIds.has(w.sourceId)&&typeof w.message==='string'&&
    (w.term===undefined||['S','F'].includes(w.term))&&
    (w.scope===undefined||validWarningScope(w.scope))&&
    ['classIds','excludedClassIds'].every(key=>w[key]===undefined||(Array.isArray(w[key])&&w[key].length>0&&w[key].every(validClassId)&&new Set(w[key]).size===w[key].length)))))return false;
  const validSource=c=>(!c.sourceId||sourceIds.has(c.sourceId)) && (c.sourcePage==null||(Number.isInteger(c.sourcePage)&&c.sourcePage>0));
  const weekDates=new Set();
  if(p.weekCalendar!==undefined&&(!Array.isArray(p.weekCalendar)||!p.weekCalendar.every(c=>{
    if(!c||typeof c.scope!=='string'||!validWarningScope(c.scope)||typeof c.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(c.date)||isoDate(...c.date.split('-').map(Number))!==c.date||!validSource(c)||typeof c.week!=='string'||typeof c.reviewed!=='boolean')return false;
    const key=JSON.stringify([c.scope,c.date]);if(weekDates.has(key))return false;weekDates.add(key);return true;
  })))return false;
  const seriesKeys=new Set();
  const validPolicy=(policy,periods)=>{
    const keys=['regularDayCounts','holidayCounts','eventCounts','ordinaryPeriodCounts','officialPeriodOverrides','confirmedNonTeachingDates','sources'];
    if(!policy||typeof policy!=='object'||Array.isArray(policy)||Object.keys(policy).length!==keys.length||keys.some(key=>!Object.hasOwn(policy,key)))return false;
    const bool=value=>value===null||typeof value==='boolean';
    const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&isoDate(...value.split('-').map(Number))===value;
    if(!bool(policy.regularDayCounts)||!bool(policy.holidayCounts)||!bool(policy.ordinaryPeriodCounts)||!policy.eventCounts||typeof policy.eventCounts!=='object'||Array.isArray(policy.eventCounts)||
      !Object.entries(policy.eventCounts).every(([key,value])=>['MIDTERM','FINAL','EXCURSION','EVENT','EXAM_RETURN','OTHER'].includes(key)&&bool(value))||
      !Array.isArray(policy.officialPeriodOverrides)||policy.officialPeriodOverrides.length>4440||
      !Array.isArray(policy.confirmedNonTeachingDates)||policy.confirmedNonTeachingDates.length>370||new Set(policy.confirmedNonTeachingDates).size!==policy.confirmedNonTeachingDates.length||!policy.confirmedNonTeachingDates.every(date)||
      !Array.isArray(policy.sources)||!policy.sources.length||policy.sources.length>128||!policy.sources.every(source=>source&&sourceIds.has(source.sourceId)&&Number.isInteger(source.page)&&source.page>0&&(source.note===undefined||typeof source.note==='string')))return false;
    const overrides=new Set();return policy.officialPeriodOverrides.every(item=>{
      if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).length!==3||!date(item.date)||!periods.includes(item.period)||!bool(item.counts))return false;
      const key=`${item.date}/${item.period}`;if(overrides.has(key))return false;overrides.add(key);return true;
    });
  };
  if(p.weekSeries!==undefined&&(!Array.isArray(p.weekSeries)||!p.weekSeries.every(item=>{
    if(!item||!['S','F'].includes(item.term)||!validClassId(item.classId)||typeof item.id!=='string'||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(item.id)||!Number.isInteger(item.dayOfWeek)||item.dayOfWeek<1||item.dayOfWeek>7||
      !Array.isArray(item.periods)||!item.periods.length||item.periods.length>12||new Set(item.periods).size!==item.periods.length||
      !item.periods.every(period=>Number.isInteger(period)&&period>=1&&period<=12)||!Array.isArray(item.lessonIds)||!item.lessonIds.length||item.lessonIds.length>1000||
      new Set(item.lessonIds).size!==item.lessonIds.length||!item.lessonIds.every(id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id))||
      !['WEEKLY','A','B'].includes(item.cycle)||typeof item.reviewed!=='boolean'||!Array.isArray(item.sources)||!item.sources.length||item.sources.length>128||
      !item.sources.every(source=>source&&sourceIds.has(source.sourceId)&&Number.isInteger(source.page)&&source.page>0&&(source.note===undefined||typeof source.note==='string'))||
      (item.countingPolicy!==undefined&&!validPolicy(item.countingPolicy,item.periods)))return false;
    const key=JSON.stringify([item.term,item.classId,item.id]);if(seriesKeys.has(key))return false;seriesKeys.add(key);return true;
  })))return false;
  const seen=new Set();
  if(!p.lessons.every(c=>{if(!c||typeof c!=='object')return false;const k=JSON.stringify([c.term,c.classId,c.day,c.period]);if(seen.has(k))return false;seen.add(k);return validSource(c)&&(c.state===undefined||['PRESENT','EMPTY','EXCLUDED'].includes(c.state))&&(c.containsExcluded===undefined||typeof c.containsExcluded==='boolean')&&(c.rawUnparsed===undefined||typeof c.rawUnparsed==='boolean')&&['S','F'].includes(c.term)&&typeof c.classId==='string'&&Number.isInteger(c.day)&&c.day>=1&&c.day<=5&&Number.isInteger(c.period)&&c.period>=1&&c.period<=12&&Array.isArray(c.entries)&&c.entries.every(e=>e&&typeof e==='object'&&!Array.isArray(e)&&Object.values(e).every(v=>typeof v==='string'))&&typeof c.reviewed==='boolean';}))return false;
  const dates=new Set();return p.calendar.every(c=>{if(!c||!validSource(c)||typeof c.scope!=='string'||typeof c.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(c.date))return false;const [year,month,day]=c.date.split('-').map(Number);if(isoDate(year,month,day)!==c.date)return false;const k=JSON.stringify([c.scope,c.date]);if(dates.has(k))return false;dates.add(k);return typeof c.reviewed==='boolean' && ['dayType','lessonDay','lessonType','label','raw'].every(k=>typeof c[k]==='string');});
}
/** Validate a copied cell before applying it to the active position. */
export function pasteTableCell(project, payload, destination, newId = () => crypto.randomUUID()) {
  if(!payload||payload.format!=='sktjf-table-cell'||!destination||payload.kind!==destination.kind||
      !payload.cell||typeof payload.cell!=='object'||Array.isArray(payload.cell))throw new Error('コピーしたセルを貼り付けてください');
  const cell=structuredClone(payload.cell);
  const sourceMissing=Boolean(cell.sourceId)&&!project.sources.some(source=>source.id===cell.sourceId);
  if(sourceMissing){cell.sourceId='';cell.sourcePage=null;}
  if(destination.kind==='lesson'){
    if(!Array.isArray(cell.entries)||!['S','F'].includes(destination.term)||!validClassId(destination.classId)||
        !Number.isInteger(destination.day)||destination.day<1||destination.day>5||
        !Number.isInteger(destination.period)||destination.period<1||destination.period>12)throw new Error('コピーしたセルを貼り付けてください');
    cell.entries=cell.entries.map(entry=>{
      if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.values(entry).some(value=>typeof value!=='string'))throw new Error('コピーしたセルを貼り付けてください');
      const result={...entry,id:newId()};
      for(const key of ['subject','teacher','room','cycle','attributes','excludedAttributes','remote','special'])result[key]??='';
      return result;
    });
    Object.assign(cell,{term:destination.term,classId:destination.classId,day:destination.day,period:destination.period,reviewed:false});
    putLesson(project,cell);
  }else if(destination.kind==='calendar'){
    if(typeof destination.scope!=='string'||!destination.scope.trim()||typeof destination.date!=='string'||
        !/^\d{4}-\d{2}-\d{2}$/.test(destination.date)||isoDate(...destination.date.split('-').map(Number))!==destination.date||
        (cell.eventKind!==undefined&&typeof cell.eventKind!=='string'))throw new Error('コピーしたセルを貼り付けてください');
    Object.assign(cell,{date:destination.date,scope:destination.scope,reviewed:false});
    project.calendar=project.calendar.filter(day=>!(day.scope===cell.scope&&day.date===cell.date));project.calendar.push(cell);
  }else throw new Error('コピーしたセルを貼り付けてください');
  // A project can be edited before a PDF is added. The temporary source is used only for shape validation.
  const candidate=project.sources.length?project:{...project,sources:[{id:'validation',name:'validation',data:'x',sha256:''}]};
  if(!validProject(candidate))throw new Error('コピーしたセルを貼り付けてください');
  return {sourceMissing};
}

/** Move one preserved old-format entry into a user-selected cell without overwriting existing work. */
export function placeLegacyEntry(project, cellIndex, entryIndex, destination, newId = () => crypto.randomUUID()) {
  const legacy=project.legacyCells[cellIndex],entry=legacy?.entries?.[entryIndex];
  if(!legacy||!entry||typeof entry!=='object'||Array.isArray(entry)||Object.values(entry).some(value=>typeof value!=='string'))
    throw new Error('旧データの内容を確認してください');
  if(!destination||destination.kind!==legacy.kind)throw new Error('同じ種類の表のセルを選択してください');
  const sourceId=legacy.sourceId||'legacy',source=project.sources.find(item=>item.id===sourceId),sourcePage=legacy.page;
  if(!source||!Number.isInteger(sourcePage)||sourcePage<1)throw new Error('旧データの参照元を確認してください');
  if(legacy.issues!==undefined&&(!Array.isArray(legacy.issues)||legacy.issues.some(issue=>typeof issue!=='string')))
    throw new Error('旧データの確認事項を確認してください');
  const original={...structuredClone(legacy),entries:[structuredClone(entry)]};
  if(destination.kind==='lesson'){
    if(!['S','F'].includes(destination.term)||!validClassId(destination.classId)||!Number.isInteger(destination.day)||destination.day<1||destination.day>5||!Number.isInteger(destination.period)||destination.period<1||destination.period>12)
      throw new Error('配置先を確認してください');
    const existing=lessonAt(project,destination.term,destination.classId,destination.day,destination.period);
    if(existing&&(!existing.entries.length||existing.state==='EXCLUDED'||existing.sourceId!==sourceId||existing.sourcePage!==sourcePage))
      throw new Error('この枠には別の内容があります。空いている枠を選択してください');
    const next=existing?structuredClone(existing):{term:destination.term,classId:destination.classId,day:destination.day,period:destination.period,entries:[],raw:'',sourceId,sourcePage};
    next.entries.push({...emptyLesson(),...structuredClone(entry),id:newId()});next.legacyRecords=[...(next.legacyRecords||[]),original];next.state='PRESENT';next.reviewed=false;putLesson(project,next);
  }else if(destination.kind==='calendar'){
    const date=destination.date,scope=destination.scope;
    if(typeof scope!=='string'||!scope.trim()||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||isoDate(...date.split('-').map(Number))!==date)
      throw new Error('配置先を確認してください');
    if(project.calendar.some(item=>item.scope===scope&&item.date===date))throw new Error('この日には別の内容があります。空いている日を選択してください');
    project.calendar.push({...emptyDay(date),scope,sourceId,sourcePage,dayType:entry.dayType||'',lessonDay:entry.lessonDay||'',lessonType:entry.lessonType||'',label:entry.label||'',legacyRecords:[original]});
  }else throw new Error('同じ種類の表のセルを選択してください');
  legacy.entries.splice(entryIndex,1);
  if(!legacy.entries.length){
    if(legacy.issues?.length)(project.warnings??=[]).push(...legacy.issues.map(issue=>({sourceId,message:`${sourcePage}ページ: ${issue}`})));
    project.legacyCells.splice(cellIndex,1);
  }
  if(!validProject(project))throw new Error('旧データを配置できませんでした');
}

/** PDF bytes are immutable strings; clone all editable state without copying those large strings. */
function historySnapshot(project) {
  if(!project||!Array.isArray(project.sources))return structuredClone(project);
  const result=structuredClone({...project,sources:[]});
  result.sources=project.sources.map(source=>{
    if(!source||typeof source!=='object'||typeof source.data!=='string')return structuredClone(source);
    return {...structuredClone({...source,data:''}),data:source.data};
  });
  return result;
}

export class History {
  constructor(initial) {this.current=historySnapshot(initial);this.undoStack=[];this.redoStack=[];this.revision=0;}
  change(fn){const next=historySnapshot(this.current);fn(next);this.undoStack.push(this.current);if(this.undoStack.length>100)this.undoStack.shift();this.redoStack=[];this.current=next;this.revision++;}
  undo(){if(!this.undoStack.length)return false;this.redoStack.push(historySnapshot(this.current));this.current=this.undoStack.pop();this.revision++;return true;}
  redo(){if(!this.redoStack.length)return false;this.undoStack.push(historySnapshot(this.current));this.current=this.redoStack.pop();this.revision++;return true;}
}

/** A completed file load must not replace edits or undo/redo activity made while it was loading. */
export function captureHistory(history) { return {history,revision:history.revision}; }
export function historyUnchanged(history, captured) { return history===captured.history && history.revision===captured.revision; }
