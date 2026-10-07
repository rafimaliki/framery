// The arrow layer. Arrows are drawn in screen space, on top of the world: a line is always 1.5px, a
// head and a label are always the same size, however far the camera is zoomed. The world-space ends
// come from geometry.js; this module owns the SVG and redraws only what is on screen.

import { resolve } from './geometry.js';
import { CAPTION_H, PILL_H, captioned, labelAt, pillWidth, route } from './routes.js';

const NS = 'http://www.w3.org/2000/svg';
const LABELS_FROM = 0.22; // below this zoom the labels would only pile up, so they wait
const DOTS_FROM = 0.1; // below this zoom the source circles wait too
const PAN_SLOP = 160; // a pure pan moves the whole layer by transform until it has gone this far

const el = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

export function createArrows(svg, { animated, lineStyle }) {
  const layer = el('g');
  svg.append(layer);
  let drawn = []; // { geometry, nodes }
  let solids = []; // the items a label should not cover
  let titled = []; // the items whose caption a label should not cover
  let anchor = null; // the view the layer was last fully drawn at
  let selected = null;
  let only = null; // a Set of arrow ids when a frame or group is focused: the rest stay hidden
  let timer = 0;

  function build(geometry, index) {
    const g = el('g', { class: `ar ${geometry.tone}`, 'data-arrow': geometry.id });
    g.style.setProperty('--i', Math.min(index, 40));
    const nodes = {
      g,
      hit: el('path', { class: 'hit' }),
      ln: el('path', { class: 'ln', pathLength: 1 }),
      hd: el('polygon', { class: 'hd' }),
      dot: el('circle', { class: 'dot', r: 4 }), // the circle on the source: where the person taps
      lab: null,
    };
    g.append(nodes.hit, nodes.ln, nodes.hd, nodes.dot);
    if (geometry.label) {
      const width = pillWidth(geometry.label);
      const pill = el('rect', { class: 'pill', x: -width / 2, y: -PILL_H / 2, width, height: PILL_H, rx: PILL_H / 2 });
      const text = el('text');
      text.textContent = geometry.label;
      nodes.lab = el('g', { class: 'lab' });
      nodes.lab.append(pill, text);
      g.append(nodes.lab);
    }
    g.classList.toggle('sel', geometry.id === selected);
    return { geometry, nodes };
  }

  function full(view, size) {
    anchor = { x: view.x, y: view.y, s: view.s };
    layer.removeAttribute('transform');
    const to = ([x, y]) => [x * view.s + view.x, y * view.s + view.y];
    const rects = [
      ...solids.map((i) => ({ x: i.x * view.s + view.x, y: i.y * view.s + view.y, w: i.w * view.s, h: i.h * view.s })),
      ...titled.map((i) => ({ x: i.x * view.s + view.x, y: i.y * view.s + view.y - CAPTION_H, w: i.w * view.s, h: CAPTION_H })),
    ];
    for (const { geometry: a, nodes } of drawn) {
      const via = {
        x: a.via.x == null ? null : a.via.x * view.s + view.x,
        y: a.via.y == null ? null : a.via.y * view.s + view.y,
        clear0: (a.via.clear0 ?? 0) * view.s,
        clear1: (a.via.clear1 ?? 0) * view.s,
        cap0: a.via.cap0,
        cap1: a.via.cap1,
      };
      const shape = route(lineStyle(), to(a.p0), a.n0, to(a.p1), a.n1, via);
      const visible = (!only || only.has(a.id)) && shape.box.x1 > -40 && shape.box.x0 < size.w + 40 && shape.box.y1 > -40 && shape.box.y0 < size.h + 40;
      nodes.g.style.display = visible ? '' : 'none';
      if (!visible) continue;
      nodes.hit.setAttribute('d', shape.d);
      nodes.ln.setAttribute('d', shape.d);
      nodes.hd.setAttribute('points', shape.head);
      if (nodes.dot) {
        const [x, y] = to(a.p0);
        nodes.dot.setAttribute('cx', x);
        nodes.dot.setAttribute('cy', y);
        nodes.dot.style.display = view.s < DOTS_FROM ? 'none' : ''; // far out, the circles would be bigger than the frames
      }
      if (nodes.lab) nodes.lab.style.display = view.s < LABELS_FROM ? 'none' : '';
      if (nodes.lab) {
        const [x, y] = shape.kind === 'bezier' ? shape.mid : labelAt(shape.points, shape.mid, pillWidth(a.label), rects);
        nodes.lab.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      }
    }
  }

  return {
    // New items or arrows, or newly measured anchors: recompute the world-space ends and rebuild.
    setData(items, arrows, boxOf) {
      layer.replaceChildren();
      drawn = resolve(arrows, items, boxOf).map(build);
      solids = items.filter((i) => ['frame', 'table', 'node'].includes(i.type));
      titled = captioned(items);
      for (const { nodes } of drawn) layer.append(nodes.g);
      anchor = null;
    },

    draw(view, size) {
      if (anchor && anchor.s === view.s && Math.abs(view.x - anchor.x) < PAN_SLOP && Math.abs(view.y - anchor.y) < PAN_SLOP) {
        layer.setAttribute('transform', `translate(${view.x - anchor.x} ${view.y - anchor.y})`);
      } else full(view, size);
    },

    // The line style setting changed: the next draw is a full one, with the new routes.
    restyle() {
      anchor = null;
    },

    // Show only these arrows (null: all). The next draw is a full one.
    only(ids) {
      only = ids;
      anchor = null;
    },

    select(id) {
      selected = id;
      for (const { geometry, nodes } of drawn) nodes.g.classList.toggle('sel', geometry.id === id);
    },

    // The lines draw themselves in when a page opens.
    playIn() {
      if (!animated()) return;
      svg.dataset.draw = '';
      clearTimeout(timer);
      timer = setTimeout(() => svg.removeAttribute('data-draw'), 1400);
    },
  };
}
