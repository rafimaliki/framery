// The floating zoom controls. They only ever call the canvas's own zoom methods.

import { bus } from '../core/bus.js';
import { icon } from '../core/dom.js';

const MODE = { all: ['arrowsAll', 'All arrows'], focus: ['arrowsFocus', 'Arrows of the focused frame'], none: ['arrowsNone', 'No arrows'] };

export function createZoombar(dom, canvas, settings, { onPick, onComment }) {
  dom.out.innerHTML = icon.minus;
  dom.in.innerHTML = icon.plus;
  dom.fit.innerHTML = icon.fit;
  dom.comment.innerHTML = icon.comment;
  dom.comment.addEventListener('click', onComment);
  const showVis = () => {
    const on = settings.get().comments === 'show';
    dom.vis.innerHTML = on ? icon.eye : icon.eyeOff;
    dom.vis.title = on ? 'Comments shown (click to hide)' : 'Comments hidden (click to show)';
    dom.vis.setAttribute('aria-pressed', String(on));
  };
  dom.vis.addEventListener('click', () => settings.set({ comments: settings.get().comments === 'show' ? 'hide' : 'show' }));
  bus.on('settings', showVis);
  showVis();
  dom.out.addEventListener('click', () => canvas.zoomBy(1 / 1.25));
  dom.in.addEventListener('click', () => canvas.zoomBy(1.25));
  dom.pct.addEventListener('click', () => canvas.zoomTo(1));
  dom.fit.addEventListener('click', () => canvas.fitAll());
  const { options } = settings;
  const showMode = () => {
    const [name, label] = MODE[settings.get().arrows];
    dom.arrows.innerHTML = icon[name];
    dom.arrows.title = `${label} (click to change)`;
    dom.arrows.setAttribute('aria-label', label);
  };
  dom.arrows.addEventListener('click', () => settings.set({ arrows: options.arrows[(options.arrows.indexOf(settings.get().arrows) + 1) % options.arrows.length] }));
  bus.on('settings', showMode);
  showMode();
  // Arrow problems on this page: a count, the list as a tooltip, and each click selects the next one.
  let problems = [];
  let next = 0;
  dom.warn.addEventListener('click', () => {
    if (!problems.length) return;
    const p = problems[next++ % problems.length];
    onPick({ kind: 'arrow', id: p.arrows?.[0] ?? p.arrow });
  });
  return {
    commenting: (on) => dom.comment.setAttribute('aria-pressed', String(on)),
    count: (n) => (dom.vis.dataset.count = n || ''), // open comments on this page
    show: (view) => (dom.pct.textContent = `${Math.round(view.s * 100)}%`),
    problems(list) {
      problems = list;
      next = 0;
      dom.warn.hidden = !list.length;
      if (!list.length) return;
      dom.warn.innerHTML = icon.warn;
      dom.warn.append(String(list.length));
      const text = `${list.length} arrow problem${list.length > 1 ? 's' : ''} (click to step through):\n${list.map((p) => p.problem).join('\n')}`;
      dom.warn.title = text;
      dom.warn.setAttribute('aria-label', text);
    },
  };
}
