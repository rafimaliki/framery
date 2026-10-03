// The page the exporter photographs. It draws a chosen set of items on a page, at 1:1 and with every
// frame live, with the arrows over them, and publishes the size it came to in window.__export once
// everything has loaded. Query: project, page, ids (comma separated; a group brings its members),
// theme (light|dark), lines (straight|curved|elbow), background (paper|transparent).

import { api } from './core/api.js';
import { h } from './core/dom.js';
import { createAnchors } from './canvas/anchors.js';
import { createArrows } from './canvas/arrows.js';
import { renderers } from './canvas/renderers/index.js';
import { caption, place } from './canvas/renderers/shared.js';

const q = new URLSearchParams(location.search);
const project = q.get('project');
const PAD = 56;
const TOP = 44; // room above the topmost item for its caption

document.documentElement.dataset.theme = q.get('theme') === 'dark' ? 'dark' : 'light';
if (q.get('background') === 'transparent') document.body.classList.add('transparent');

const page = await api.page(project, q.get('page'));
const wanted = new Set((q.get('ids') ?? '').split(',').filter(Boolean));
const include = new Set();
const visit = (id) => {
  if (include.has(id)) return;
  include.add(id);
  for (const item of page.items) if (item.parent === id) visit(item.id);
};
wanted.forEach(visit);
const items = page.items.filter((item) => include.has(item.id));
if (!items.length) throw new Error('nothing to export');

const x0 = Math.min(...items.map((i) => i.x)) - PAD;
const y0 = Math.min(...items.map((i) => i.y)) - PAD - TOP;
const width = Math.ceil(Math.max(...items.map((i) => i.x + i.w)) + PAD - x0);
const height = Math.ceil(Math.max(...items.map((i) => i.y + i.h)) + PAD - y0);
const stage = document.getElementById('stage');
stage.style.width = `${width}px`;
stage.style.height = `${height}px`;
const world = document.getElementById('world');
world.style.transform = `translate(${-x0}px, ${-y0}px)`;

const pending = [];
const ctx = { project: () => project, rev: () => 0, frameRev: () => 0 };
const order = { group: 0, node: 1, frame: 2, table: 2 };

for (const item of [...items].sort((a, b) => (order[a.type] ?? 1) - (order[b.type] ?? 1))) {
  let el;
  if (item.type === 'frame') {
    // every frame is a live page here: no picture stands in for it, and nothing is rationed
    const frame = h('iframe', { src: api.file(project, item.src), scrolling: 'no', title: item.title ?? item.id });
    pending.push(new Promise((resolve) => frame.addEventListener('load', resolve, { once: true })));
    el = h('div', { class: 'it fr', 'data-device': item.device ?? 'frame' }, caption(item), h('div', { class: 'bd live' }, frame));
    place(el, item);
  } else el = renderers[item.type]?.create(item, ctx);
  if (!el) continue;
  el.style.zIndex = order[item.type] ?? 1;
  world.append(el);
}

// Arrows between the exported items, anchored to elements as in the studio.
const anchors = createAnchors({ project: () => project, rev: () => 0 });
const arrows = createArrows(document.getElementById('arrows'), { animated: () => false, lineStyle: () => q.get('lines') ?? 'elbow' });
const arrowList = page.arrows.filter((a) => include.has(a.from.split('#')[0]) && include.has(a.to.split('#')[0]));
const refs = arrowList.flatMap((a) => [a.from, a.to]).filter((r) => r.includes('#')).map((r) => r.split('#')[0]);
await anchors.ensure(refs, () => {});
arrows.setData(items, arrowList, (id, name) => anchors.box(id, name));
arrows.draw({ x: -x0, y: -y0, s: 1 }, { w: width, h: height });

await Promise.all(pending);
await document.fonts.ready;
window.__export = { width, height };
