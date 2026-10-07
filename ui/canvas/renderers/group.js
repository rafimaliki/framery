// A group: a darkened, low-opacity container, like a Figma section. Frames sit on top of it.
// Its caption keeps one screen size above it, so zoomed far out it would land on whatever sits just above
// the group: then it waits (data-tight) until there is room, or the group is hovered or selected.

import { h } from '../../core/dom.js';
import { caption, place, recaption } from './shared.js';

export default {
  type: 'group',
  create(item) {
    const el = h('div', { class: 'it gp', 'data-id': item.id }, caption(item));
    place(el, item);
    return el;
  },
  update(el, item) {
    place(el, item);
    recaption(el, item);
  },
  tuneAll(entries, { scale, items }) {
    const gaps = gapsOf(items);
    for (const { item, el } of entries) el.toggleAttribute('data-tight', gaps.get(item.id) * scale < CAPTION);
  },
};

const CAPTION = 26; // screen px a group caption needs above its group (13px text, 9px padding)
const cache = new WeakMap(); // the page's items -> group id -> world gap above it

// How much free space sits above each group: up to the nearest item fully above it that shares some of
// its width, or to the top of a group around it (whose own caption sits just above that edge).
export function gapsOf(items) {
  if (cache.has(items)) return cache.get(items);
  const gaps = new Map();
  for (const g of items) {
    if (g.type !== 'group') continue;
    let gap = Infinity;
    for (const i of items) {
      if (i === g || i.y >= g.y || i.x >= g.x + g.w || i.x + i.w <= g.x) continue;
      if (i.y + i.h <= g.y + 1) gap = Math.min(gap, g.y - (i.y + i.h));
      else if (i.type === 'group' && i.y + i.h >= g.y + g.h) gap = Math.min(gap, g.y - i.y);
    }
    gaps.set(g.id, gap);
  }
  cache.set(items, gaps);
  return gaps;
}
