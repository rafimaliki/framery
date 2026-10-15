// What both places that take comments (the player and the canvas) share: naming an element of a screen
// so the agent can find it again, and the small box where a note is written or read.

import { h } from './dom.js';

// A selector that finds el again: its id, or the tags and positions down from body.
export function pathOf(el) {
  const parts = [];
  for (; el && !['BODY', 'HTML'].includes(el.tagName); el = el.parentElement) {
    if (el.id) return [`#${CSS.escape(el.id)}`, ...parts].join(' > ');
    const same = [...el.parentElement.children].filter((c) => c.tagName === el.tagName);
    parts.unshift(el.tagName.toLowerCase() + (same.length > 1 ? `:nth-of-type(${same.indexOf(el) + 1})` : ''));
  }
  return ['body', ...parts].join(' > ');
}

// An element as add_note wants it. box is in the screen's own pixels, which is how a pin is placed later.
export function describe(el) {
  const r = el.getBoundingClientRect();
  return {
    selector: pathOf(el),
    anchor: el.dataset?.anchor || el.id || undefined,
    html: el.outerHTML.slice(0, 600),
    label: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 120) || undefined,
    box: [r.x, r.y, r.width, r.height].map(Math.round),
  };
}

// One box at a time, placed in window pixels inside `host` (a modal dialog needs it inside itself).
export function createNotePopup(host) {
  let box = null;
  const close = () => (box?.remove(), (box = null));
  const msg = () => h('p', { class: 'note-pop__msg' });
  const fail = (error) => box?.querySelector('.note-pop__msg')?.replaceChildren(error.message);
  const btn = (label, onclick) => h('button', { class: 'text-btn', type: 'button', onclick }, label);
  const open = ({ left, top }, ...kids) => {
    close();
    box = h('div', { class: 'note-pop' }, ...kids);
    box.style.left = `${Math.max(8, Math.min(left, innerWidth - 292))}px`;
    box.style.top = `${Math.max(8, Math.min(top, innerHeight - 190))}px`;
    host.append(box);
    return box;
  };
  return {
    close,
    // save(text) returns a promise; the box closes when it resolves and shows the error when it fails
    compose(at, save) {
      const area = h('textarea', { class: 'note-pop__input', rows: 3, placeholder: 'What should change here?' });
      const ok = btn('Save');
      const submit = () => {
        if (!area.value.trim()) return;
        ok.disabled = true;
        save(area.value).then(close, (error) => ((ok.disabled = false), fail(error)));
      };
      ok.addEventListener('click', submit);
      area.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit();
        if (event.key === 'Escape') (event.preventDefault(), close()); // not the dialog's own Esc
      });
      open(at, area, msg(), h('div', { class: 'note-pop__row' }, btn('Cancel', close), ok));
      area.focus();
    },
    // remove() returns a promise; the box closes when it resolves
    show(at, note, remove) {
      open(at, h('p', { class: 'note-pop__text' }, note.text), msg(), h('div', { class: 'note-pop__row' }, btn('Close', close), btn('Delete', () => remove().then(close, fail))));
    },
  };
}
