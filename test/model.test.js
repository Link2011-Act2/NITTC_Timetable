import test from 'node:test';
import assert from 'node:assert/strict';
import { History, isProjectShape, mergeCells, newCell, projectIssues, splitCell, validateRect } from '../web/model.js';

test('split and merge retain content and require review', () => {
  const cell = newCell(1, [0.1, 0.2, 0.7, 0.8]);
  cell.entries[0].subject = '数学'; cell.reviewed = true;
  const parts = splitCell(cell, 'vertical');
  assert.ok(Math.abs(parts[0].rect[2] - 0.4) < 1e-12);
  assert.equal(parts[0].rect[2], parts[1].rect[0]);
  assert.deepEqual([parts[0].rect[0], parts[1].rect[2]], [0.1, 0.7]);
  assert.ok(parts.every(x => !x.reviewed && x.entries[0].subject === '数学'));
  const merged = mergeCells(parts);
  assert.equal(merged.entries.length, 2);
  assert.equal(merged.reviewed, false);
  assert.throws(() => mergeCells([parts[0], { ...parts[1], page: 2 }]));
});

test('unreviewed, unresolved and invalid cells cannot pass review gate', () => {
  const cell = newCell(1, [0, 0, 0.5, 0.5]);
  const project = { pdf: 'data', cells: [cell] };
  assert.ok(projectIssues(project).length);
  cell.reviewed = true; cell.issues = ['要確認'];
  assert.ok(projectIssues(project).length);
  cell.issues = []; assert.deepEqual(projectIssues(project), []);
  cell.rect = [0, 0, 2, 1]; assert.ok(projectIssues(project).length);
  assert.equal(validateRect([0, 0, 0, 1]), false);
});

test('undo and redo restore independent snapshots and new edits clear redo', () => {
  const history = new History({ cells: [] });
  history.change(p => p.cells.push('a')); history.change(p => p.cells.push('b'));
  history.undo(); assert.deepEqual(history.current.cells, ['a']);
  history.redo(); assert.deepEqual(history.current.cells, ['a', 'b']);
  history.undo(); history.change(p => p.cells.push('c'));
  assert.equal(history.redo(), false); assert.deepEqual(history.current.cells, ['a', 'c']);
});

test('project import rejects malformed or duplicate cell records', () => {
  const cell = newCell(1, [0, 0, 0.5, 0.5]);
  const project = { version: 1, pdf: 'data', pdfName: 'test.pdf', cells: [cell] };
  assert.equal(isProjectShape(project), true);
  assert.equal(isProjectShape({ ...project, cells: [cell, cell] }), false);
  assert.equal(isProjectShape({ ...project, cells: [{ ...cell, issues: [null] }] }), false);
  assert.equal(isProjectShape({ ...project, cells: [{ ...cell, entries: [null] }] }), false);
  assert.equal(isProjectShape({ ...project, pdfName: null }), false);
});
