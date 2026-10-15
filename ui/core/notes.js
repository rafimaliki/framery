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

// "div#save.btn.btn--primary": enough to tell which part of the html a note is about
export const nameOf = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + [...el.classList].slice(0, 2).map((c) => `.${c}`).join('');

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
  // What the note is about: the element's html name and the words in it.
  const about = ({ name, label }) => h('div', { class: 'note-pop__about' }, h('code', null, name ?? 'element'), label ? h('span', null, label) : null);
  const open = ({ left, top }, ...kids) => {
    close();
    box = h('div', { class: 'note-pop' }, ...kids);
    box.style.left = `${Math.max(8, Math.min(left, innerWidth - 348))}px`;
    box.style.top = `${Math.max(8, Math.min(top, innerHeight - 280))}px`;
    host.append(box);
    return box;
  };
  return {
    close,
    // save(text) returns a promise; the box closes when it resolves and shows the error when it fails
    // context is { name, label } of the element, shown so the person sees what the note is pinned to
    compose(at, save, context) {
      const area = h('textarea', { class: 'note-pop__input', rows: 3, placeholder: 'What should change here?', 'aria-label': 'Comment' });
      const ok = h('button', { class: 'note-pop__send', type: 'button', disabled: true }, 'Send');
      const grow = () => {
        area.style.height = 'auto';
        area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
        ok.disabled = !area.value.trim();
      };
      const submit = () => {
        if (ok.disabled) return; // empty, or already sending
        ok.disabled = true;
        save(area.value).then(close, (error) => ((ok.disabled = false), fail(error)));
      };
      ok.addEventListener('click', submit);
      area.addEventListener('input', grow);
      area.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) (event.preventDefault(), submit()); // Shift+Enter: a new line
        if (event.key === 'Escape') (event.preventDefault(), close()); // not the dialog's own Esc
      });
      open(at, about(context ?? {}), area, msg(), h('div', { class: 'note-pop__row' }, h('span', { class: 'note-pop__hint' }, 'Enter to send · Shift+Enter for a new line'), btn('Cancel', close), ok));
      area.focus();
    },
    // remove() returns a promise; the box closes when it resolves
    show(at, note, remove) {
      open(at, about({ name: note.selector?.split(' > ').pop(), label: note.label }), h('p', { class: 'note-pop__text' }, note.text), h('p', { class: 'note-pop__wait' }, 'Sent to the agent. This disappears when it is done.'), msg(), h('div', { class: 'note-pop__row' }, btn('Close', close), btn('Delete', () => remove().then(close, fail))));
    },
  };
}
