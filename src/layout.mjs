// Pure helpers over one page's items and arrows: where things go, how a group wraps its members,
// and the plain-text reading order an agent gets instead of a picture.

import { fail } from './store.mjs';
import { asText } from './tables.mjs';

// phone, tablet, desktop: a real screen of that device only. document: anything else (a spec, a gallery, a token
// sheet), at a fixed width with its height measured from the page.
export const DEVICES = { phone: [390, 844], tablet: [820, 1180], desktop: [1280, 800], document: [960, 1200] };
export const GAP = 120;

export const refItem = (ref) => ref.split('#')[0];
export const refElement = (ref) => ref.split('#')[1] ?? null;

export function find(page, id) {
  const item = page.items.find((entry) => entry.id === id);
  if (!item) fail(`no item ${JSON.stringify(id)} on page ${page.id}`);
  return item;
}

export const members = (page, groupId) => page.items.filter((item) => item.parent === groupId);

// A group and everything inside it, nested groups included.
export function withMembers(page, ids) {
  const out = new Set();
  const visit = (id) => {
    if (out.has(id)) return;
    out.add(id);
    for (const child of members(page, id)) visit(child.id);
  };
  ids.forEach(visit);
  return [...out].map((id) => find(page, id));
}

// The top edge gets extra room: a frame's caption sits above it, and a caption must stay inside its group.
const CAPTION = 32;

export function fitGroup(page, id, padding = 48) {
  const group = find(page, id);
  const inside = members(page, id);
  if (!inside.length) return group;
  const left = Math.min(...inside.map((m) => m.x));
  const top = Math.min(...inside.map((m) => m.y));
  group.x = left - padding;
  group.y = top - padding - CAPTION;
  group.w = Math.max(...inside.map((m) => m.x + m.w)) + padding - group.x;
  group.h = Math.max(...inside.map((m) => m.y + m.h)) + padding - group.y;
  if (group.parent) fitGroup(page, group.parent, padding);
  return group;
}

// Free placement is the point, so an item with no position goes right of what is already there, or
// right of its group's last member, and the group grows to hold it.
export function place(page, item) {
  if (Number.isFinite(item.x) && Number.isFinite(item.y)) return;
  const pool = item.parent ? members(page, item.parent) : page.items.filter((i) => !i.parent);
  if (!pool.length) {
    item.x = item.parent ? find(page, item.parent).x + 48 : 0;
    item.y = item.parent ? find(page, item.parent).y + 48 : 0;
    return;
  }
  item.x = Math.max(...pool.map((i) => i.x + i.w)) + GAP;
  item.y = Math.min(...pool.map((i) => i.y));
}

export function arrange(page, ids, { direction = 'row', gap = GAP, x, y, align = 'start' } = {}) {
  const list = ids.map((id) => find(page, id));
  if (!list.length) return list;
  let cursor = direction === 'row' ? (x ?? list[0].x) : (y ?? list[0].y);
  const cross = direction === 'row' ? (y ?? list[0].y) : (x ?? list[0].x);
  const span = Math.max(...list.map((i) => (direction === 'row' ? i.h : i.w)));
  for (const item of list) {
    const offset = align === 'center' ? (span - (direction === 'row' ? item.h : item.w)) / 2 : 0;
    const target = direction === 'row' ? { x: cursor, y: cross + offset } : { x: cross + offset, y: cursor };
    const moveX = target.x - item.x;
    const moveY = target.y - item.y;
    for (const part of withMembers(page, [item.id])) {
      part.x += moveX;
      part.y += moveY;
    }
    cursor += (direction === 'row' ? item.w : item.h) + gap;
  }
  for (const parent of new Set(list.map((i) => i.parent).filter(Boolean))) fitGroup(page, parent);
  return list;
}

// Lay a flow out from its arrows: the main path in one row, left to right (the longest chain of screens, the
// happier arrow when two are as long: "yes" before "no"); every other item directly under
// the main-path item it belongs to (the one it points back to, else the one that leads to it), stacked
// downward when several share a column. Items are the given ids (a group's members move with them); an
// arrow end inside one of them counts as that item. Returns the items, moved.
const TONE_ORDER = { positive: 0, neutral: 1, negative: 2 };

export function layoutFlow(page, ids, { gap = 140, rowGap = 160, x, y } = {}) {
  const list = ids.map((id) => find(page, id));
  if (!list.length) return list;
  const inSet = new Set(ids);
  const top = (ref) => {
    for (let id = refItem(ref); id; id = page.items.find((i) => i.id === id)?.parent) if (inSet.has(id)) return id;
    return null;
  };
  const edges = (page.arrows ?? [])
    .map((r) => ({ from: top(r.from), to: top(r.to), rank: TONE_ORDER[r.tone] ?? 1 }))
    .filter((e) => e.from && e.to && e.from !== e.to);
  const byId = new Map(list.map((i) => [i.id, i]));
  const reading = (a, b) => a.y - b.y || a.x - b.x;

  // the main row: from the entry, the way out that leads furthest, the happier one on a tie
  // ponytail: plain depth-first search, exponential on a dense graph; flows are a few dozen items
  const reach = (id, seen) => Math.max(0, ...edges.filter((e) => e.from === id && !seen.has(e.to)).map((e) => 1 + reach(e.to, new Set([...seen, e.to]))));
  // the entry: no arrows in and some out (an item with no arrows at all is not a start), top-left first
  const score = (i) => Number(edges.some((e) => e.to === i.id)) * 2 + Number(!edges.some((e) => e.from === i.id));
  const entry = [...list].sort((a, b) => score(a) - score(b) || reading(a, b))[0];
  const main = [entry.id];
  for (;;) {
    const seen = new Set(main);
    const next = edges
      .filter((e) => e.from === main.at(-1) && !seen.has(e.to))
      .map((e) => ({ ...e, far: reach(e.to, new Set([...seen, e.to])) }))
      .sort((a, b) => b.far - a.far || a.rank - b.rank)[0];
    if (!next) break;
    main.push(next.to);
  }
  // the rest: under the main item it returns to, else the one it came from; unconnected ones go last
  const column = new Map(main.map((id) => [id, []]));
  const placed = new Set(main);
  for (let grew = true; grew; ) {
    grew = false;
    for (const item of [...list].sort(reading)) {
      if (placed.has(item.id)) continue;
      const home = (dir) => edges.filter((e) => e[dir === 'out' ? 'from' : 'to'] === item.id).map((e) => (dir === 'out' ? e.to : e.from)).find((id) => placed.has(id));
      const at = home('out') ?? home('in');
      if (!at) continue;
      const owner = column.has(at) ? at : [...column].find(([, below]) => below.includes(at))[0];
      column.get(owner).push(item.id);
      placed.add(item.id);
      grew = true;
    }
  }
  const loose = list.filter((i) => !placed.has(i.id)).sort(reading).map((i) => i.id);

  const moveTo = (item, tx, ty) => {
    const dx = tx - item.x;
    const dy = ty - item.y;
    for (const part of withMembers(page, [item.id])) {
      part.x += dx;
      part.y += dy;
    }
  };
  const left = x ?? Math.min(...list.map((i) => i.x));
  const top0 = y ?? Math.min(...list.map((i) => i.y));
  const rowH = Math.max(...main.map((id) => byId.get(id).h));
  let cursor = left;
  for (const id of [...main, ...loose]) {
    const item = byId.get(id);
    moveTo(item, cursor, top0 + (rowH - item.h) / 2);
    let below = top0 + rowH + rowGap;
    for (const under of column.get(id) ?? []) {
      const u = byId.get(under);
      moveTo(u, cursor + (item.w - u.w) / 2, below);
      below += u.h + rowGap;
    }
    cursor += Math.max(item.w, ...(column.get(id) ?? []).map((u) => byId.get(u).w)) + gap;
  }
  for (const parent of new Set(list.map((i) => i.parent).filter(Boolean))) fitGroup(page, parent);
  return list;
}

// Left to right along each row, rows top to bottom: how a page is read when nothing connects it.
function rowMajor(list) {
  const rows = [];
  for (const item of [...list].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((r) => item.y < r.top + r.height * 0.5);
    if (row) {
      row.items.push(item);
      row.height = Math.min(row.height, item.h);
    } else rows.push({ top: item.y, height: item.h, items: [item] });
  }
  return rows.flatMap((r) => r.items.sort((a, b) => a.x - b.x));
}

// Sources before targets (arrows decide the order); left to right when arrows do not.
function reading(page, list) {
  const ids = new Set(list.map((i) => i.id));
  const into = new Map(list.map((i) => [i.id, 0]));
  const edges = page.arrows
    .map((a) => [refItem(a.from), refItem(a.to)])
    .filter(([a, b]) => ids.has(a) && ids.has(b) && a !== b);
  for (const [, b] of edges) into.set(b, into.get(b) + 1);
  const left = rowMajor(list);
  const out = [];
  while (left.length) {
    const next = left.find((i) => into.get(i.id) === 0) ?? left[0];
    left.splice(left.indexOf(next), 1);
    out.push(next);
    for (const [a, b] of edges) if (a === next.id) into.set(b, into.get(b) - 1);
  }
  return out;
}

const line = (page, item) => {
  const size = item.type === 'group' ? '' : ` ${item.w}x${item.h}`;
  const kind = item.type === 'frame' ? item.device ?? 'frame' : item.shape ?? item.type;
  const out = page.arrows
    .filter((a) => refItem(a.from) === item.id)
    .map((a) => `${a.from.includes('#') ? a.from.split('#')[1] + ' ' : ''}-> ${a.to}${a.label ? ` "${a.label}"` : ''}${a.tone && a.tone !== 'neutral' ? ` [${a.tone}]` : ''}`);
  const tag = item.step ? `${item.step} ` : '';
  const grid = item.type === 'table' ? `\n${asText(item).replace(/^/gm, '    ')}` : ''; // a table is read as its cells
  return `- [${item.id}] ${tag}${item.title ?? ''} (${kind}${size})${item.description ? ': ' + item.description : ''}${grid}${out.length ? '\n    ' + out.join('\n    ') : ''}${item.src ? `\n    src ${item.src}` : ''}`;
};

export function outline(page) {
  const top = page.items.filter((i) => !i.parent);
  const lines = [`# ${page.title ?? page.id}${page.description ? ' - ' + page.description : ''}`];
  const walk = (list, depth) => {
    for (const item of reading(page, list)) {
      if (item.type === 'group') {
        lines.push(`\n${'#'.repeat(Math.min(depth + 1, 4))} [${item.id}] ${item.title ?? ''}${item.description ? '\n' + item.description : ''}`);
        walk(members(page, item.id), depth + 1);
      } else lines.push(line(page, item));
    }
  };
  walk(top.sort((a, b) => a.y - b.y || a.x - b.x), 1);
  return lines.join('\n');
}
