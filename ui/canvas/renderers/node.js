// A flowchart node: terminal (start or end), process (a step), diamond (a branch).

import { h } from '../../core/dom.js';
import { place } from './shared.js';

const NS = 'http://www.w3.org/2000/svg';
const INSET = 1.5; // half the stroke, so the outline stays inside the box

function shape(item) {
  const { w, h: height, shape: kind } = item;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'shape');
  svg.setAttribute('viewBox', `0 0 ${w} ${height}`);
  let mark;
  if (kind === 'diamond') {
    mark = document.createElementNS(NS, 'path');
    mark.setAttribute('d', `M${w / 2} ${INSET} L${w - INSET} ${height / 2} L${w / 2} ${height - INSET} L${INSET} ${height / 2} Z`);
  } else {
    mark = document.createElementNS(NS, 'rect');
    mark.setAttribute('x', INSET);
    mark.setAttribute('y', INSET);
    mark.setAttribute('width', w - INSET * 2);
    mark.setAttribute('height', height - INSET * 2);
    mark.setAttribute('rx', kind === 'terminal' ? height / 2 : 14);
  }
  svg.append(mark);
  return svg;
}

function fill(el, item) {
  el.replaceChildren(shape(item), h('div', { class: 'txt' }, item.title ?? ''));
  el.dataset.shape = item.shape;
}

export default {
  type: 'node',
  create(item) {
    const el = h('div', { class: 'it nd', 'data-id': item.id });
    place(el, item);
    fill(el, item);
    return el;
  },
  update(el, item) {
    place(el, item);
    fill(el, item);
  },
};
