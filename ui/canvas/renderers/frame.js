// A frame: one screen of any size, drawn from an html file. It shows a preview image, and the live
// page when it is big enough on screen to be worth one (see frame-content.js).

import { h } from '../../core/dom.js';
import { FLAT_BELOW, LIVE_FROM, LIVE_MAX, createContent } from './frame-content.js';
import { caption, place, recaption } from './shared.js';

const contents = new WeakMap();
const distance = (item, at) => Math.hypot(item.x + item.w / 2 - at.x, item.y + item.h / 2 - at.y);

export default {
  type: 'frame',

  create(item, ctx) {
    const el = h('div', { class: 'it fr', 'data-id': item.id, 'data-device': item.device ?? 'frame' }, caption(item), h('div', { class: 'bd' }));
    place(el, item);
    contents.set(el, createContent(el, item, ctx));
    return el;
  },

  update(el, item) {
    place(el, item);
    recaption(el, item);
    el.dataset.device = item.device ?? 'frame';
  },

  destroy(el) {
    contents.get(el)?.dispose();
    contents.delete(el);
  },

  // Called with every frame on screen. Previews follow zoom; live pages are rationed: settled, big
  // enough on screen, and only the few nearest the middle of it.
  tuneAll(entries, { scale, centre, settled }) {
    const near = entries
      .filter(({ item }) => item.w * scale >= LIVE_FROM)
      .sort((a, b) => distance(a.item, centre) - distance(b.item, centre))
      .slice(0, LIVE_MAX)
      .map(({ el }) => el);
    const allowed = settled ? new Set(near) : null;
    for (const { item, el } of entries) {
      const content = contents.get(el);
      const px = item.w * scale;
      const base = px < FLAT_BELOW ? 'flat' : 'img';
      if (px < LIVE_FROM * 0.8) content.setMode(base);
      else if (allowed) content.setMode(allowed.has(el) ? 'live' : base);
      else if (content.mode !== 'live') content.setMode(base);
    }
  },

  restate(el) {
    contents.get(el)?.restate();
  },

  refreshImages(els) {
    for (const el of els) contents.get(el)?.refreshImage();
  },

  reload(els, paths) {
    for (const el of els) {
      const content = contents.get(el);
      if (content && (!paths || paths.some((path) => content.showsPath(path)))) content.reload();
    }
  },
};
