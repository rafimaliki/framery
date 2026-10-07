// The world layer: the page's items as elements, only for the ones near the screen. Which element an
// item becomes is the renderer registry's business; this module owns mounting, unmounting and
// reconciling, and it hands each type's renderer the items it has on screen to tune.

import { LAYER } from './renderers/index.js';

const MARGIN = 0.5; // keep elements this much of a screen beyond each edge, so panning never shows holes

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const touches = (item, box) => item.x < box.x1 && item.x + item.w > box.x0 && item.y < box.y1 && item.y + item.h > box.y0;

export function createWorld(root, renderers, ctx) {
  let items = [];
  let selected = null;
  const mounted = new Map(); // id -> { item, el }
  let hidden = new Set(); // ids of items kept off the page (flowchart nodes whose arrows are all hidden)

  function unmount(id) {
    const entry = mounted.get(id);
    if (!entry) return;
    renderers[entry.item.type]?.destroy?.(entry.el);
    entry.el.remove();
    mounted.delete(id);
  }

  function mount(item) {
    const renderer = renderers[item.type];
    if (!renderer) return;
    const el = renderer.create(item, ctx);
    el.style.zIndex = LAYER[item.type] ?? 1;
    el.classList.toggle('sel', item.id === selected);
    el.style.display = hidden.has(item.id) ? 'none' : '';
    root.append(el);
    mounted.set(item.id, { item, el });
  }

  return {
    // New page data. Items that changed are updated in place; items that went are dropped.
    setItems(next) {
      const byId = new Map(next.map((item) => [item.id, item]));
      for (const [id, entry] of mounted) {
        const item = byId.get(id);
        if (!item || item.type !== entry.item.type) unmount(id);
        else if (!same(item, entry.item)) {
          renderers[item.type].update(entry.el, item, ctx);
          entry.item = item;
        } else entry.item = item;
      }
      items = next;
    },

    // Mount what is near the screen, unmount what is not, then let each renderer tune its own.
    sync(view, size, settled) {
      root.dataset.lod = view.s < 0.18 ? 'far' : 'near';
      const box = {
        x0: (-view.x - size.w * MARGIN) / view.s,
        y0: (-view.y - size.h * MARGIN) / view.s,
        x1: (size.w * (1 + MARGIN) - view.x) / view.s,
        y1: (size.h * (1 + MARGIN) - view.y) / view.s,
      };
      for (const item of items) {
        if (touches(item, box)) {
          if (!mounted.has(item.id)) mount(item);
        } else unmount(item.id);
      }
      const centre = { x: (size.w / 2 - view.x) / view.s, y: (size.h / 2 - view.y) / view.s };
      const byType = new Map();
      for (const entry of mounted.values()) {
        if (!byType.has(entry.item.type)) byType.set(entry.item.type, []);
        byType.get(entry.item.type).push(entry);
      }
      for (const [type, entries] of byType) renderers[type].tuneAll?.(entries, { scale: view.s, centre, settled, items }, ctx);
    },

    hide(ids) {
      hidden = ids;
      for (const [id, { el }] of mounted) el.style.display = hidden.has(id) ? 'none' : '';
    },

    select(id) {
      selected = id;
      for (const [key, { el }] of mounted) el.classList.toggle('sel', key === id);
    },

    refreshImages() {
      for (const type of new Set([...mounted.values()].map((e) => e.item.type))) {
        renderers[type].refreshImages?.([...mounted.values()].filter((e) => e.item.type === type).map((e) => e.el));
      }
    },

    reload(paths) {
      for (const type of new Set([...mounted.values()].map((e) => e.item.type))) {
        renderers[type].reload?.([...mounted.values()].filter((e) => e.item.type === type).map((e) => e.el), paths);
      }
    },

    clear() {
      for (const id of [...mounted.keys()]) unmount(id);
      items = [];
    },

    // Replay the entrance: the page fades up when it opens.
    enter() {
      root.removeAttribute('data-enter');
      void root.offsetWidth;
      root.setAttribute('data-enter', '');
    },
  };
}
