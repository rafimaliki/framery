// What every item on the canvas has in common: a box in world coordinates and a caption above it.

import { h } from '../../core/dom.js';

export function place(el, item) {
  el.style.transform = `translate(${item.x}px, ${item.y}px)`;
  el.style.width = `${item.w}px`;
  el.style.height = `${item.h}px`;
}

export function caption(item) {
  return h('div', { class: 'lb' }, item.step ? h('b', null, item.step) : null, item.title ?? '');
}

export function recaption(el, item) {
  const old = el.querySelector(':scope > .lb');
  if (old) old.replaceWith(caption(item));
}
