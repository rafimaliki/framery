// Comments on the canvas: a numbered pin on the screen each was written on, and, in comment mode, the
// element under the pointer is outlined and a click opens the note box for it. The screen may be only a
// preview picture, so the element is found in the page itself: the live iframe when one shows, else a
// hidden one kept while comment mode is on.

import { h } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { createNotePopup, describe, nameOf } from '../../core/notes.js';

export function createCanvasNotes(world, view, { project, frameRev, page, liveDoc, toWorld, onAdd, onRemove, onReply }) {
  const layer = h('div', { class: 'notes' });
  const hoverTag = h('span', { class: 'note-hover__tag' });
  const hover = h('div', { class: 'note-hover', hidden: true }, hoverTag);
  world.append(layer);
  const popup = createNotePopup(document.body);
  let notes = [];
  let visible = true;
  let active = false; // comment mode
  let seen = 0; // the latest pointer move, so a slow page load does not outline an old spot
  const hidden = new Map(); // frame id -> the document of a hidden iframe, while comment mode is on

  const frameAt = (x, y) => [...(page()?.items ?? [])].reverse().find((i) => i.type === 'frame' && x >= i.x && x <= i.x + i.w && y >= i.y && y <= i.y + i.h);

  // The document of a screen: the live one, or a hidden iframe of the screen's own size.
  function docOf(frame) {
    const live = liveDoc(frame.id);
    if (live) return Promise.resolve(live);
    if (!hidden.has(frame.id)) {
      hidden.set(
        frame.id,
        new Promise((resolve, reject) => {
          const el = h('iframe', { tabindex: '-1', 'aria-hidden': 'true', src: api.file(project(), frame.src, frameRev()) });
          el.style.cssText = `position:fixed;left:-99999px;top:0;width:${frame.w}px;height:${frame.h}px;border:0;opacity:0`;
          el.addEventListener('load', () => resolve(el.contentDocument));
          el.addEventListener('error', () => (hidden.delete(frame.id), el.remove(), reject(new Error(`could not open ${frame.src}`))));
          document.body.append(el);
        }),
      );
    }
    return hidden.get(frame.id);
  }

  // The element at a point in the screen, never the whole document.
  function elementAt(doc, x, y) {
    const hit = doc.elementFromPoint(x, y);
    return !hit || hit === doc.documentElement ? doc.body : hit;
  }

  function mark(frame, el) {
    hover.hidden = !el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    Object.assign(hover.style, { left: `${frame.x + r.x}px`, top: `${frame.y + r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    hoverTag.textContent = nameOf(el);
  }

  function paint() {
    layer.hidden = !visible;
    layer.replaceChildren(hover);
    if (!visible) return;
    const frames = new Map((page()?.items ?? []).filter((i) => i.type === 'frame').map((i) => [i.id, i]));
    notes.forEach((note, n) => {
      const frame = frames.get(note.item);
      if (!frame) return;
      const pin = h('button', { class: `note-pin${note.question ? ' note-pin--ask' : ''}`, type: 'button', 'data-note': note.id, title: note.text }, String(n + 1));
      pin.style.left = `${frame.x + (note.box?.[0] ?? 0)}px`;
      pin.style.top = `${frame.y + (note.box?.[1] ?? 0)}px`;
      layer.append(pin);
    });
  }

  view.addEventListener('pointermove', async (event) => {
    if (!active || event.buttons) return; // not while panning
    const box = view.getBoundingClientRect();
    const p = toWorld(event.clientX - box.left, event.clientY - box.top);
    const frame = frameAt(p.x, p.y);
    const mine = ++seen;
    if (!frame) return mark(null);
    const doc = await docOf(frame).catch(() => null);
    if (doc && mine === seen) mark(frame, elementAt(doc, p.x - frame.x, p.y - frame.y));
  });
  view.addEventListener('pointerleave', () => mark(null));

  return {
    // The notes of the open page, whether to draw their pins, and whether a click makes a new one.
    set(next) {
      notes = next.list;
      visible = next.visible;
      if (active && !next.commenting) {
        for (const doc of hidden.values()) doc.then((d) => d.defaultView?.frameElement?.remove(), () => {});
        hidden.clear();
      }
      active = next.commenting;
      view.toggleAttribute('data-commenting', active);
      popup.close();
      paint();
      mark(null);
    },
    paint,

    // A pin was tapped: read it, or delete it.
    read(pin) {
      const note = notes.find((x) => x.id === pin.dataset.note);
      const r = pin.getBoundingClientRect();
      if (note) popup.show({ left: r.left, top: r.bottom + 6 }, note, () => onRemove(note.id), (text) => onReply(note.id, text));
    },

    // A tap in comment mode, at a point in the world (x, y) and on the window (at).
    async comment(x, y, at) {
      popup.close();
      const frame = frameAt(x, y);
      const doc = frame && (await docOf(frame).catch(() => null));
      if (!doc) return;
      const el = elementAt(doc, x - frame.x, y - frame.y);
      const found = describe(el);
      popup.compose({ left: at.x, top: at.y + 12 }, (text) => onAdd({ item: frame.id, text, ...found }), { name: nameOf(el), label: found.label });
    },
  };
}
