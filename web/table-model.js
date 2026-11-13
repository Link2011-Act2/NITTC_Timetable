export const classIds = ['1-1','1-2','1-3','1-4', ...[2,3,4,5].flatMap(y => ['M','E','I','B'].map(c => `${y}${c}`))];
export const emptyLesson = () => ({ id:crypto.randomUUID(), subject:'', teacher:'', room:'', cycle:'', attributes:'', special:'' });
export const emptyDay = date => ({ date, dayType:'', lessonDay:'', lessonType:'', label:'', reviewed:false, raw:'' });
export function emptyProject(pdf, pdfName, year, term) {
  return {version:3,sources:pdf?[{id:'legacy',name:pdfName,data:pdf,sha256:''}]:[],year,term,lessons:[],calendar:[],legacyCells:[],warnings:[]};
}
export function lessonAt(project, term, classId, day, period) {
  return project.lessons.find(c=>c.term===term && c.classId===classId && c.day===day && c.period===period);
}
export function putLesson(project, cell) {
  project.lessons=project.lessons.filter(c=>!(c.term===cell.term && c.classId===cell.classId && c.day===cell.day && c.period===cell.period));
  project.lessons.push(cell);
}
export function isoDate(year, month, day) {
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day ? date.toISOString().slice(0,10) : null;
}
export function dateAdd(date, days) { const d=new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
export function mondayOf(date) { const d=new Date(`${date}T00:00:00Z`); return dateAdd(date,-((d.getUTCDay()+6)%7)); }
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
export function validProject(p) {
  if (!p || p.version!==3 || !Array.isArray(p.sources) || !p.sources.length || !Number.isInteger(p.year) || p.year<2000 || p.year>2100 || !['S','F'].includes(p.term) || !Array.isArray(p.lessons) || !Array.isArray(p.calendar) || !Array.isArray(p.legacyCells)) return false;
  const sourceIds=new Set();if(!p.sources.every(s=>{if(!s||typeof s.id!=='string'||!s.id||sourceIds.has(s.id)||typeof s.name!=='string'||typeof s.data!=='string'||!s.data||typeof s.sha256!=='string'||(s.sha256!==''&&!/^[a-f0-9]{64}$/.test(s.sha256)))return false;sourceIds.add(s.id);return true;}))return false;
  if(p.warnings!==undefined&&(!Array.isArray(p.warnings)||!p.warnings.every(w=>w&&sourceIds.has(w.sourceId)&&typeof w.message==='string')))return false;
  const validSource=c=>(!c.sourceId||sourceIds.has(c.sourceId)) && (c.sourcePage==null||(Number.isInteger(c.sourcePage)&&c.sourcePage>0));
  const seen=new Set();
  if(!p.lessons.every(c=>{if(!c||typeof c!=='object')return false;const k=JSON.stringify([c.term,c.classId,c.day,c.period]);if(seen.has(k))return false;seen.add(k);return validSource(c)&&(c.state===undefined||['PRESENT','EMPTY','EXCLUDED'].includes(c.state))&&(c.containsExcluded===undefined||typeof c.containsExcluded==='boolean')&&['S','F'].includes(c.term)&&typeof c.classId==='string'&&Number.isInteger(c.day)&&c.day>=1&&c.day<=5&&Number.isInteger(c.period)&&c.period>=1&&c.period<=12&&Array.isArray(c.entries)&&c.entries.every(e=>e&&typeof e==='object'&&!Array.isArray(e)&&Object.values(e).every(v=>typeof v==='string'))&&typeof c.reviewed==='boolean';}))return false;
  const dates=new Set();return p.calendar.every(c=>{if(!c||!validSource(c)||typeof c.scope!=='string'||typeof c.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(c.date))return false;const [year,month,day]=c.date.split('-').map(Number);if(isoDate(year,month,day)!==c.date)return false;const k=JSON.stringify([c.scope,c.date]);if(dates.has(k))return false;dates.add(k);return typeof c.reviewed==='boolean' && ['dayType','lessonDay','lessonType','label','raw'].every(k=>typeof c[k]==='string');});
}
export class History {
  constructor(initial) {this.current=structuredClone(initial);this.undoStack=[];this.redoStack=[];}
  change(fn){this.undoStack.push(structuredClone(this.current));if(this.undoStack.length>100)this.undoStack.shift();this.redoStack=[];fn(this.current);}
  undo(){if(!this.undoStack.length)return false;this.redoStack.push(structuredClone(this.current));this.current=this.undoStack.pop();return true;}
  redo(){if(!this.redoStack.length)return false;this.undoStack.push(structuredClone(this.current));this.current=this.redoStack.pop();return true;}
}
