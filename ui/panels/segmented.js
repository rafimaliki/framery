// A segmented control with a thumb that slides to the chosen option.

import { h } from '../core/dom.js';

export function segmented({ label, options, value, onChange }) {
  const thumb = h('span', { class: 'seg__thumb', 'aria-hidden': 'true' });
  const buttons = options.map((option) =>
    h('button', { class: 'seg__opt', type: 'button', onclick: () => onChange(option.value) }, option.label),
  );
  const root = h('div', { class: 'seg', role: 'group', 'aria-label': label }, thumb, ...buttons);
  root.style.setProperty('--n', options.length);

  const show = (current) => {
    root.style.setProperty('--at', Math.max(0, options.findIndex((o) => o.value === current)));
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(options[i].value === current)));
  };
  show(value);
  return { el: root, show };
}
