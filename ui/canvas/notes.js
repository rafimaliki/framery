// Comments on the canvas: a numbered pin on the screen each was written on, and, in comment mode, a click
// on a screen asks which element is under it and opens the note box. The screen may be only a preview
// picture, so the element is found in the page itself: the live iframe when one shows, else a hidden one.

import { h } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { createNotePopup, describe } from '../../core/notes.js';

export function createCanvasNotes(world, view, { project, frameRev, page, liveDoc, onAdd, onRemove }) {
  const layer = h('div', { class: 'notes' });
  world.append(layer);
  const popup = createNotePopup(document.body);
  let notes = [];
  let visible = true;

  // The document of a screen, with a way to let go of it.
  function open(frame) {
    const live = liveDoc(frame.id);
    if (live) return Promise.resolve({ doc: live, done() {} });
    return new Promise((resolve, reject) => {
      const el = h('iframe', { tabindex: '-1', 'aria-hidden': 'true', src: api.file(project(), frame.src, frameRev()) });
      el.style.cssText = `position:fixed;left:-99999px;top:0;width:${frame.w}px;height:${frame.h}px;border:0;opacity:0`;
      el.addEventListener('load', () => resolve({ doc: el.contentDocument, done: () => el.remove() }));
      el.addEventListener('error', () => (el.remove(), reject(new Error(`could not open ${frame.src}`))));
      document.body.append(el);
    });
  }

  function paint() {
    layer.hidden = !visible;
    layer.replaceChildren();
    if (!visible) return;
    const frames = new Map((page()?.items ?? []).filter((i) => i.type === 'frame').map((i) => [i.id, i]));
    notes.forEach((note, n) => {
      const frame = frames.get(note.item);
      if (!frame) return;
      const pin = h('button', { class: 'note-pin', type: 'button', 'data-note': note.id, title: note.text }, String(n + 1));
      pin.style.left = `${frame.x + (note.box?.[0] ?? 0)}px`;
      pin.style.top = `${frame.y + (note.box?.[1] ?? 0)}px`;
      layer.append(pin);
    });
  }

  return {
    // The notes of the open page, whether to draw their pins, and whether a click makes a new one.
    set(next) {
      notes = next.list;
      visible = next.visible;
      view.toggleAttribute('data-commenting', next.commenting);
      popup.close();
      paint();
    },
    paint,

    // A pin was tapped: read it, or delete it.
    read(pin) {
      const note = notes.find((x) => x.id === pin.dataset.note);
      const r = pin.getBoundingClientRect();
      if (note) popup.show({ left: r.left, top: r.bottom + 6 }, note, () => onRemove(note.id));
    },

    // A tap in comment mode, at a point in the world (x, y) and on the window (at).
    async comment(x, y, at) {
      popup.close();
      const frame = [...(page()?.items ?? [])].reverse().find((i) => i.type === 'frame' && x >= i.x && x <= i.x + i.w && y >= i.y && y <= i.y + i.h);
      if (!frame) return;
      const { doc, done } = await open(frame).catch(() => ({}));
      if (!doc) return;
      const hit = doc.elementFromPoint(x - frame.x, y - frame.y);
      const el = !hit || hit === doc.documentElement ? doc.body : hit;
      const found = describe(el);
      done();
      popup.compose({ left: at.x, top: at.y + 12 }, (text) => onAdd({ item: frame.id, text, ...found }));
    },
  };
}
