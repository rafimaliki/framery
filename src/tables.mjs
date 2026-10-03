// A table is a canvas item like a frame or a group: it has a position and a size, and it holds
// columns, rows and cells. The plan is one. Everything an agent does to a table is a small edit here
// (one cell, one row), and the item's height is recomputed from its content so it never needs a
// browser to measure.
//
//   { type: 'table', id, x, y, w, h, title, description,
//     columns: [{ id, title, note? }],
//     rows:    [{ id, title, link?, cells: { <columnId>: <text> } }],
//     marks:   { <cell text>: <style> } }       a cell whose text is a key of marks is drawn as a pill

import { fail } from './store.mjs';

export const MARK_STYLES = ['positive', 'accent', 'outline', 'hatch', 'faint'];
const HEAD = 96; // header height, px in the world
const ROW = 52;
const FIRST = 240; // first column
const COLUMN = 190;

export const tableSize = (table) => ({ w: FIRST + COLUMN * table.columns.length, h: HEAD + ROW * table.rows.length + 8 });

const NAME = /^[\w.-]+$/;

export function checkTable(table) {
  if (!Array.isArray(table.columns) || !table.columns.length) fail('a table needs columns: [{id, title}]');
  if (!Array.isArray(table.rows)) fail('a table needs rows: [{id, title, cells}]');
  const seen = (list, what) => {
    const ids = new Set();
    for (const entry of list) {
      if (!entry || typeof entry.id !== 'string' || !NAME.test(entry.id)) fail(`${what} needs an id of letters, digits, . _ -`);
      if (ids.has(entry.id)) fail(`duplicate ${what} id ${entry.id}`);
      ids.add(entry.id);
      if (typeof entry.title !== 'string') fail(`${what} ${entry.id} needs a title`);
    }
    return ids;
  };
  const columns = seen(table.columns, 'column');
  seen(table.rows, 'row');
  for (const row of table.rows) {
    row.cells ??= {};
    for (const [column, value] of Object.entries(row.cells)) {
      if (!columns.has(column)) fail(`row ${row.id}: no column ${column}; have ${[...columns].join(', ')}`);
      if (typeof value !== 'string') fail(`row ${row.id}, column ${column}: a cell is text`);
    }
  }
  table.marks ??= {};
  for (const [value, style] of Object.entries(table.marks)) {
    if (!MARK_STYLES.includes(style)) fail(`mark "${value}": style must be one of ${MARK_STYLES.join(', ')}`);
  }
}

// Give the table the size its content needs. The width follows the column count; the height the row count.
export function fit(table) {
  checkTable(table);
  Object.assign(table, tableSize(table));
  return table;
}

function rowOf(table, id) {
  const row = table.rows.find((r) => r.id === id);
  if (!row) fail(`no row ${JSON.stringify(id)}; have ${table.rows.map((r) => r.id).join(', ') || 'none'}`);
  return row;
}

function columnOf(table, id) {
  const column = table.columns.find((c) => c.id === id);
  if (!column) fail(`no column ${JSON.stringify(id)}; have ${table.columns.map((c) => c.id).join(', ')}`);
  return column;
}

export function setCell(table, rowId, columnId, value) {
  const row = rowOf(table, rowId);
  columnOf(table, columnId);
  if (value === '' || value == null) delete row.cells[columnId];
  else row.cells[columnId] = String(value);
  return fit(table);
}

export function addRow(table, row, before) {
  if (table.rows.some((r) => r.id === row.id)) fail(`row ${row.id} exists`);
  const at = before ? table.rows.indexOf(rowOf(table, before)) : table.rows.length;
  table.rows.splice(at, 0, { cells: {}, ...row });
  return fit(table);
}

export function removeRow(table, rowId) {
  table.rows.splice(table.rows.indexOf(rowOf(table, rowId)), 1);
  return fit(table);
}

export function addColumn(table, column, before) {
  if (table.columns.some((c) => c.id === column.id)) fail(`column ${column.id} exists`);
  const at = before ? table.columns.indexOf(columnOf(table, before)) : table.columns.length;
  table.columns.splice(at, 0, column);
  return fit(table);
}

export function removeColumn(table, columnId) {
  if (table.columns.length === 1) fail('a table keeps at least one column');
  table.columns.splice(table.columns.indexOf(columnOf(table, columnId)), 1);
  for (const row of table.rows) delete row.cells[columnId];
  return fit(table);
}

// The table as text, for an agent that reads instead of looks: a header, then one line per row.
export function asText(table) {
  const cell = (row, c) => row.cells?.[c.id] || '-';
  const lines = [`| ${['', ...table.columns.map((c) => c.title)].join(' | ')} |`];
  for (const row of table.rows) lines.push(`| ${[row.title, ...table.columns.map((c) => cell(row, c))].join(' | ')} |${row.link ? `  -> ${row.link}` : ''}`);
  return lines.join('\n');
}
