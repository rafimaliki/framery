// What a frame shows inside, and how much it is allowed to cost.
//
//   flat  nothing but the frame's surface        (so small on screen that a picture is wasted)
//   img   the cached WebP preview                 (cheap; the default)
//   live  the real page in an iframe              (only when large on screen, settled, and in budget)
//
// A live iframe is a whole document, so only a few exist at once, nearest the middle of the screen first.
// The preview stays underneath and fades out when the iframe has loaded, so nothing flashes.

import { h } from '../../core/dom.js';
import { api } from '../../core/api.js';

export const FLAT_BELOW = 20; // on-screen width in px: smaller than this a picture is invisible, so a paper-coloured block stands in
export const LIVE_FROM = 170;
export const LIVE_MAX = 6;

export function createContent(el, item, ctx) {
  const body = el.querySelector(':scope > .bd');
  let mode = 'flat';
  let image = null;
  let frame = null;
  let missing = null;

  function showImage() {
    if (image || missing) return;
    image = h('img', { alt: '', decoding: 'async', draggable: 'false' });
    image.addEventListener('error', () => {
      image?.remove();
      image = null;
      missing = h('div', { class: 'ph' }, item.step ?? '', h('small', null, item.title ?? item.id));
      body.append(missing);
    });
    image.src = api.preview(ctx.project(), item.id, ctx.rev());
    body.prepend(image);
  }

  function hideImage() {
    image?.remove();
    missing?.remove();
    image = missing = null;
  }

  function showLive() {
    if (frame) return;
    frame = h('iframe', { tabindex: '-1', scrolling: 'no', 'aria-hidden': 'true', title: item.title ?? item.id });
    frame.addEventListener('load', () => {
      frame?.classList.add('ready');
      body.classList.add('live');
    });
    frame.src = api.file(ctx.project(), item.src, ctx.frameRev());
    body.append(frame);
  }

  function hideLive() {
    frame?.remove();
    frame = null;
    body.classList.remove('live');
  }

  return {
    get mode() {
      return mode;
    },
    setMode(next) {
      if (next === mode) return;
      mode = next;
      if (next === 'flat') {
        hideLive();
        hideImage();
      } else {
        showImage();
        if (next === 'live') showLive();
        else hideLive();
      }
    },
    // The preview was re-rendered: load it again, even if it was missing before.
    refreshImage() {
      if (mode === 'flat') return;
      hideImage();
      showImage();
    },
    // The page changed on disk: reload the live iframe if it is showing.
    reload() {
      if (!frame) return;
      frame.classList.remove('ready');
      body.classList.remove('live');
      frame.src = api.file(ctx.project(), item.src, ctx.frameRev());
    },
    dispose() {
      hideLive();
      hideImage();
    },
    showsPath: (path) => item.src === path,
  };
}
