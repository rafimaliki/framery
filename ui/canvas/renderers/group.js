// A group: a darkened, low-opacity container, like a Figma section. Frames sit on top of it.

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
};
