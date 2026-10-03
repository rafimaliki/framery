// The outline drawn around a selected component, on top of the frame it sits in. Boxes are in world
// coordinates, so the outline lives in the world layer and follows every pan and zoom with it.

import { h } from '../core/dom.js';

export function createOutline(world) {
  const layer = h('div', { class: 'outline', 'aria-hidden': 'true' });
  world.append(layer);
  return {
    show(rects) {
      layer.replaceChildren(
        ...rects.map((r) => {
          const box = h('div', { class: 'hl' });
          box.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
          return box;
        }),
      );
    },
    clear() {
      layer.replaceChildren();
    },
  };
}
