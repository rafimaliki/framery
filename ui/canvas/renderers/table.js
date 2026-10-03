// A table: columns across, rows down, a cell is a word. A word listed in the table's `marks` is drawn as
// a pill, which is how the plan shows status. A row with a link carries `data-link` on its name; a tap
// on it is handled by the canvas, which opens the target ("flows/6_entry" is that group on that page).
// Rows and the header have fixed heights in the world, matching src/tables.mjs, so the item's stored
// size is always right without measuring anything.

import { h } from '../../core/dom.js';
import { caption, place, recaption } from './shared.js';

const FIRST = 240;
const COLUMN = 190;

function cell(table, row, column) {
  const value = row.cells?.[column.id];
  if (!value) return h('td', { class: 'tb__empty' }, '—');
  const style = table.marks?.[value];
  return h('td', null, style ? h('span', { class: `mk mk--${style}` }, value) : value);
}

function fill(card, item) {
  const head = h('tr', null, h('th', null), ...item.columns.map((c) => h('th', null, h('span', { class: 'tb__col' }, c.title), c.note ? h('span', { class: 'tb__note' }, c.note) : null)));
  const rows = item.rows.map((row) => {
    const name = row.link ? h('span', { class: 'tb__link' }, row.title) : row.title;
    return h('tr', null, h('th', { scope: 'row', 'data-link': row.link, class: row.link ? 'tb__linked' : null }, name), ...item.columns.map((c) => cell(item, row, c)));
  });
  const cols = h('colgroup', null, h('col', { style: `width:${FIRST}px` }), ...item.columns.map(() => h('col', { style: `width:${COLUMN}px` })));
  card.replaceChildren(h('table', { class: 'tb__table' }, cols, h('thead', null, head), h('tbody', null, ...rows)));
}

export default {
  type: 'table',
  create(item) {
    const card = h('div', { class: 'tb__card' });
    fill(card, item);
    const el = h('div', { class: 'it tb', 'data-id': item.id }, caption(item), card);
    place(el, item);
    return el;
  },
  update(el, item) {
    place(el, item);
    recaption(el, item);
    fill(el.querySelector(':scope > .tb__card'), item);
  },
};
