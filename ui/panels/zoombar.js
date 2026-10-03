// The floating zoom controls. They only ever call the canvas's own zoom methods.

import { icon } from '../core/dom.js';

export function createZoombar(dom, canvas) {
  dom.out.innerHTML = icon.minus;
  dom.in.innerHTML = icon.plus;
  dom.fit.innerHTML = icon.fit;
  dom.out.addEventListener('click', () => canvas.zoomBy(1 / 1.25));
  dom.in.addEventListener('click', () => canvas.zoomBy(1.25));
  dom.pct.addEventListener('click', () => canvas.zoomTo(1));
  dom.fit.addEventListener('click', () => canvas.fitAll());
  return { show: (view) => (dom.pct.textContent = `${Math.round(view.s * 100)}%`) };
}
