// PDF coordinates are normalized to the page, so changing zoom does not change a cell.
export function newCell(page, rect, kind = 'lesson') {
  return { id: crypto.randomUUID(), page, rect, kind, reviewed: false, issues: [],
    entries: [emptyEntry(kind)] };
}

export function emptyEntry(kind) {
  return kind === 'calendar'
    ? { date: '', dayType: '', lessonDay: '', lessonType: '', label: '' }
    : { subject: '', teacher: '', room: '', day: '', period: '', classId: '', cycle: '', attributes: '', special: '' };
}

export function validateRect(rect) {
  return Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite) &&
    rect[0] >= 0 && rect[1] >= 0 && rect[2] <= 1 && rect[3] <= 1 && rect[2] > rect[0] && rect[3] > rect[1];
}

export function isProjectShape(project) {
  if (!project || project.version !== 1 || typeof project.pdf !== 'string' || !project.pdf ||
      typeof project.pdfName !== 'string' || !Array.isArray(project.cells)) return false;
  const ids = new Set();
  return project.cells.every(cell => {
    if (!cell || typeof cell.id !== 'string' || !cell.id || ids.has(cell.id)) return false;
    ids.add(cell.id);
    return Number.isInteger(cell.page) && cell.page > 0 && ['lesson', 'calendar'].includes(cell.kind) &&
      validateRect(cell.rect) && typeof cell.reviewed === 'boolean' && Array.isArray(cell.issues) &&
      cell.issues.every(issue => typeof issue === 'string') && Array.isArray(cell.entries) && cell.entries.length > 0 &&
      cell.entries.every(entry => entry && typeof entry === 'object' && !Array.isArray(entry) &&
        Object.values(entry).every(value => typeof value === 'string'));
  });
}

export function splitCell(cell, direction) {
  if (!['vertical', 'horizontal'].includes(direction) || !validateRect(cell.rect)) throw new Error('Invalid split');
  const [x1, y1, x2, y2] = cell.rect;
  const mid = direction === 'vertical' ? (x1 + x2) / 2 : (y1 + y2) / 2;
  const rects = direction === 'vertical' ? [[x1, y1, mid, y2], [mid, y1, x2, y2]] : [[x1, y1, x2, mid], [x1, mid, x2, y2]];
  return rects.map(rect => ({ ...structuredClone(cell), id: crypto.randomUUID(), rect, reviewed: false,
    issues: [...new Set([...cell.issues, '分割後の内容を確認'])] }));
}

export function mergeCells(cells) {
  if (cells.length < 2 || cells.some(c => c.page !== cells[0].page || c.kind !== cells[0].kind || !validateRect(c.rect))) throw new Error('同じページ・種類のセルを選択してください');
  return { id: crypto.randomUUID(), page: cells[0].page, kind: cells[0].kind,
    rect: [Math.min(...cells.map(c => c.rect[0])), Math.min(...cells.map(c => c.rect[1])), Math.max(...cells.map(c => c.rect[2])), Math.max(...cells.map(c => c.rect[3]))],
    entries: cells.flatMap(c => structuredClone(c.entries)), reviewed: false,
    issues: [...new Set([...cells.flatMap(c => c.issues), '結合後の内容を確認'])] };
}

export function projectIssues(project) {
  const issues = [];
  if (!project.pdf || !Array.isArray(project.cells)) return ['PDFまたはセルがありません'];
  for (const cell of project.cells) {
    if (!cell.reviewed) issues.push(`${cell.id}: 未確認`);
    if (!validateRect(cell.rect)) issues.push(`${cell.id}: 範囲が不正`);
    if (!Array.isArray(cell.entries) || !cell.entries.length) issues.push(`${cell.id}: 内容がありません`);
    for (const issue of cell.issues || []) issues.push(`${cell.id}: ${issue}`);
  }
  if (!project.cells.length) issues.push('セルがありません');
  return issues;
}

export class History {
  constructor(initial) { this.current = structuredClone(initial); this.undoStack = []; this.redoStack = []; }
  change(fn) { this.undoStack.push(structuredClone(this.current)); if (this.undoStack.length > 100) this.undoStack.shift(); this.redoStack = []; fn(this.current); }
  undo() { if (this.undoStack.length) { this.redoStack.push(structuredClone(this.current)); this.current = this.undoStack.pop(); return true; } return false; }
  redo() { if (this.redoStack.length) { this.undoStack.push(structuredClone(this.current)); this.current = this.redoStack.pop(); return true; } return false; }
}
