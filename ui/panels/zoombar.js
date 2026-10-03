// The floating zoom controls. They only ever call the canvas's own zoom methods.

import { bus } from '../core/bus.js';
import { icon } from '../core/dom.js';

const MODE = { all: ['arrowsAll', 'All arrows'], focus: ['arrowsFocus', 'Arrows of the focused frame'], none: ['arrowsNone', 'No arrows'] };

export function createZoombar(dom, canvas, settings) {
  dom.out.innerHTML = icon.minus;
  dom.in.innerHTML = icon.plus;
  dom.fit.innerHTML = icon.fit;
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
  return { show: (view) => (dom.pct.textContent = `${Math.round(view.s * 100)}%`) };
}
