// Tooltips for the floating tool islands (the zoom bar and any island beside it): a small dark label above
// the button, in place of the browser's slow, unstyled one. Mouse hover waits a moment; keyboard focus shows
// it at once. The text is the button's title, else its aria-label. The native title is taken off while the
// tooltip is in charge (the label stays as the accessible name), so the two never show together.

import { h } from '../core/dom.js';

const DELAY = 400; // ms of hover before the tip appears
const GAP = 8; // between the button and the tip
const EDGE = 8; // the tip keeps this far from the window's edge

// What the tooltip says: a title that was just set wins over an older tip; the label is the fallback.
export const tipText = (el) => el.getAttribute('title') || el.dataset.tip || el.getAttribute('aria-label') || '';

// Where the tip goes: centred above the button, kept inside the window, flipped below when there is no room above.
export function tipSpot({ anchor, tip, view }) {
  const left = Math.max(EDGE, Math.min(anchor.left + anchor.width / 2 - tip.w / 2, view.w - tip.w - EDGE));
  const above = anchor.top - tip.h - GAP;
  const below = above < EDGE;
  return { left, top: below ? anchor.top + anchor.height + GAP : above, below };
}

export function createTooltips(islands) {
  const tip = h('div', { class: 'tip', role: 'tooltip', id: 'tip' });
  document.body.append(tip);
  let timer = 0;
  let on = null; // the button the tip is for

  // take the native title off, keeping the words: as the tip's text and, if there is none, as the accessible name
  const claim = (el) => {
    const title = el.getAttribute('title');
    if (!title) return;
    el.dataset.tip = title;
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', title);
    el.removeAttribute('title');
  };

  function hide() {
    clearTimeout(timer);
    tip.removeAttribute('data-show');
    on?.removeAttribute('aria-describedby');
    on = null;
  }

  function show(el) {
    const text = tipText(el);
    if (!text) return;
    on = el;
    tip.textContent = text;
    tip.style.left = '0px';
    tip.style.top = '0px';
    const box = tip.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const spot = tipSpot({ anchor: r, tip: { w: box.width, h: box.height }, view: { w: innerWidth, h: innerHeight } });
    tip.style.left = `${spot.left}px`;
    tip.style.top = `${spot.top}px`;
    tip.dataset.show = '';
    el.setAttribute('aria-describedby', 'tip');
  }

  const buttonOf = (event) => event.target.closest?.('button, a');
  for (const island of islands) {
    island.addEventListener('pointerover', (event) => {
      const el = buttonOf(event);
      if (!el || event.pointerType !== 'mouse' || el === on) return;
      claim(el);
      hide();
      timer = setTimeout(() => show(el), DELAY);
    });
    island.addEventListener('pointerout', (event) => buttonOf(event) && hide());
    island.addEventListener('pointerdown', hide);
    island.addEventListener('focusin', (event) => {
      const el = buttonOf(event);
      if (!el || !el.matches(':focus-visible')) return; // a click's focus is not a reason to explain the button
      claim(el);
      show(el);
    });
    island.addEventListener('focusout', hide);
  }
  addEventListener('keydown', (event) => event.key === 'Escape' && hide());
  addEventListener('wheel', hide, { passive: true });
  return { hide };
}
