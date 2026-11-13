export const classIds = ['1-1','1-2','1-3','1-4', ...[2,3,4,5].flatMap(y => ['M','E','I','B'].map(c => `${y}${c}`))];
export const emptyLesson = () => ({ subject:'', teacher:'', room:'', cycle:'', attributes:'', special:'' });
export const emptyDay = date => ({ date, dayType:'', lessonDay:'', lessonType:'', label:'', reviewed:false, raw:'' });
export function emptyProject(pdf, pdfName, year, term) {
  return {version:2,pdf,pdfName,year,term,lessons:[],calendar:[],legacyCells:[]};
}
export function lessonAt(project, term, classId, day, period) {
  return project.lessons.find(c=>c.term===term && c.classId===classId && c.day===day && c.period===period);
}
export function putLesson(project, cell) {
  project.lessons=project.lessons.filter(c=>!(c.term===cell.term && c.classId===cell.classId && c.day===cell.day && c.period===cell.period));
  if(cell.entries.length) project.lessons.push(cell);
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
export function validProject(p) {
  if (!p || p.version!==2 || typeof p.pdf!=='string' || !p.pdf || typeof p.pdfName!=='string' || !Number.isInteger(p.year) || p.year<2000 || p.year>2100 || !['S','F'].includes(p.term) || !Array.isArray(p.lessons) || !Array.isArray(p.calendar) || !Array.isArray(p.legacyCells)) return false;
  const seen=new Set();
  if(!p.lessons.every(c=>{if(!c||typeof c!=='object')return false;const k=JSON.stringify([c.term,c.classId,c.day,c.period]);if(seen.has(k))return false;seen.add(k);return ['S','F'].includes(c.term)&&typeof c.classId==='string'&&Number.isInteger(c.day)&&c.day>=1&&c.day<=5&&Number.isInteger(c.period)&&c.period>=1&&c.period<=12&&Array.isArray(c.entries)&&c.entries.every(e=>e&&typeof e==='object'&&!Array.isArray(e)&&Object.values(e).every(v=>typeof v==='string'))&&typeof c.reviewed==='boolean';}))return false;
  const dates=new Set();return p.calendar.every(c=>{if(!c||typeof c.scope!=='string'||typeof c.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(c.date))return false;const [year,month,day]=c.date.split('-').map(Number);if(isoDate(year,month,day)!==c.date)return false;const k=JSON.stringify([c.scope,c.date]);if(dates.has(k))return false;dates.add(k);return typeof c.reviewed==='boolean' && ['dayType','lessonDay','lessonType','label','raw'].every(k=>typeof c[k]==='string');});
}
export class History {
  constructor(initial) {this.current=structuredClone(initial);this.undoStack=[];this.redoStack=[];}
  change(fn){this.undoStack.push(structuredClone(this.current));if(this.undoStack.length>100)this.undoStack.shift();this.redoStack=[];fn(this.current);}
  undo(){if(!this.undoStack.length)return false;this.redoStack.push(structuredClone(this.current));this.current=this.undoStack.pop();return true;}
  redo(){if(!this.redoStack.length)return false;this.undoStack.push(structuredClone(this.current));this.current=this.redoStack.pop();return true;}
}
