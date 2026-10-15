// Play a flow as a prototype: one screen at a time, live, and a click on a control that an arrow starts
// from goes where the arrow goes. A click anywhere else flashes what can be clicked. A diamond on the way
// is asked as a question, one button per answer; arrows that start on no control (a timeout, a failed
// sign-in) are buttons under the screen. Back, Esc, and the canvas follows to the last screen played.
// In a tab of its own (play.html, `tab: true`) it fills the window and only ever goes back, never away.

import { api } from '../core/api.js';
import { h, icon } from '../core/dom.js';
import { createNotePopup, describe } from '../core/notes.js';

const end = (ref) => ref.split('#')[0];
const element = (ref) => ref.split('#')[1] ?? null;
const PAD = 48; // room around the screen inside the stage



// Where a group's flow starts: the one item inside it (at any depth) with arrows out and none in. None,
// or more than one, and the group is not one playable flow.
export function flowStart(page, groupId) {
  const inside = new Set([groupId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const i of page.items) if (i.parent && inside.has(i.parent) && !inside.has(i.id)) inside.add(i.id), (grew = true);
  }
  inside.delete(groupId);
  const arrows = page.arrows ?? [];
  const starts = [...inside].filter((id) => arrows.some((a) => end(a.from) === id) && !arrows.some((a) => end(a.to) === id));
  return starts.length === 1 ? starts[0] : null;
}

export function createPlayer({ project, page, pageId, rev, onExit = () => {}, onScreen = () => {}, tab: own = false }) {
  const title = h('h2', { class: 'player__title' });
  const back = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back', title: 'Back', html: icon.back });
  const close = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Stop playing', title: 'Stop playing (Esc)', html: icon.close });
  const tab = h('a', { class: 'icon-btn', target: '_blank', rel: 'noopener', 'aria-label': 'Play in a new tab', title: 'Play in a new tab', html: icon.external });
  const comment = h('button', { class: 'text-btn player__comment', type: 'button', 'aria-pressed': 'false', title: 'Comment on a part of the screen' }, 'Comment');
  const stage = h('div', { class: 'player__stage' });
  const ways = h('div', { class: 'player__ways' });
  const dialog = h('dialog', { class: `player${own ? ' player--tab' : ''}`, 'aria-label': 'Play the flow' }, h('header', { class: 'player__head' }, back, title, comment, ...(own ? [] : [tab, close])), stage, ways);
  if (own) dialog.addEventListener('cancel', (event) => event.preventDefault()); // Esc would leave an empty tab
  document.body.append(dialog);
  let trail = []; // ids played, the last one showing
  let fit = () => {};
  let noting = false; // comment mode
  let shown = 0; // which screen is showing, so a slow reply for the last one is dropped
  const popup = createNotePopup(dialog);
  const closePopup = popup.close;

  const item = (id) => page().items.find((i) => i.id === id);
  const out = (id) => page().arrows.filter((a) => end(a.from) === id);
  const way = (arrow) => h('button', { class: `text-btn player__way player__way--${arrow.tone ?? 'neutral'}`, type: 'button', onclick: () => go(end(arrow.to)) }, arrow.label || item(end(arrow.to))?.title || end(arrow.to));

  // Where an arrow leads, as something that can be shown: a group opens on its first screen, a terminal
  // node passes straight through, anything else is shown as it is.
  function land(id, seen = new Set()) {
    const it = item(id);
    if (!it || seen.has(id)) return id;
    seen.add(id);
    if (it.type === 'group') {
      const first = page().items.filter((i) => i.parent === id && i.type === 'frame').sort((a, b) => a.y - b.y || a.x - b.x)[0];
      return first ? first.id : id;
    }
    if (it.type === 'node' && it.shape !== 'diamond' && out(id).length === 1) return land(end(out(id)[0].to), seen);
    return id;
  }

  function go(id, push = true) {
    id = land(id);
    if (push) trail.push(id);
    show(id);
  }

  function show(id) {
    const it = item(id);
    const mine = ++shown;
    closePopup();
    back.disabled = trail.length < 2;
    title.replaceChildren(...(it?.step ? [h('span', { class: 'inspector__step' }, `${it.step} `)] : []), it?.title ?? id);
    tab.href = `/play.html?${new URLSearchParams({ project: project(), page: pageId(), start: id })}`;
    onScreen(id, it?.title ?? id);
    const leaving = out(id);
    ways.replaceChildren(...leaving.filter((a) => !element(a.from) && it?.type === 'frame').map(way));
    if (!it || it.type !== 'frame') {
      // a question (a diamond), or anything that is not a screen: its ways out are the choices
      stage.replaceChildren(h('div', { class: 'player__ask' }, h('p', null, it?.title ?? id), ...(leaving.length ? leaving.map(way) : [h('p', { class: 'player__end' }, 'The flow ends here.')])));
      fit = () => {};
      return;
    }
    const hot = new Map(leaving.filter((a) => element(a.from)).map((a) => [element(a.from), end(a.to)]));
    const frame = h('iframe', { class: 'player__frame', title: it.title ?? it.id, src: api.file(project(), it.src, rev()) });
    frame.style.width = `${it.w}px`;
    frame.style.height = `${it.h}px`;
    const pins = h('div', { class: 'player__pins' });
    const box = h('div', { class: 'player__screen' }, frame, pins);
    stage.replaceChildren(box);
    let doc = null;
    let notes = [];
    let scale = 1;

    // Just under an element (r is its box in the screen's own pixels), in window pixels.
    const under = (r) => {
      const f = frame.getBoundingClientRect();
      return { left: f.left + r.left * scale, top: f.top + r.bottom * scale + 6 };
    };

    function paintPins() {
      pins.replaceChildren();
      if (!doc) return;
      notes.forEach((note, n) => {
        const el = note.selector && doc.querySelector(note.selector);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const pin = h('button', { class: 'player__pin', type: 'button', title: note.text }, String(n + 1));
        pin.style.left = `${Math.max(0, r.left * scale - 11)}px`;
        pin.style.top = `${Math.max(0, r.top * scale - 11)}px`;
        const drop = () => api.command('resolve_note', { project: project(), id: note.id }).then(() => ((notes = notes.filter((x) => x !== note)), paintPins()));
        pin.addEventListener('click', () => popup.show(under(r), note, drop));
        pins.append(pin);
      });
    }

    fit = () => {
      scale = Math.min(1, (stage.clientWidth - PAD) / it.w, (stage.clientHeight - PAD) / it.h);
      frame.style.transform = `scale(${scale})`;
      box.style.width = `${it.w * scale}px`;
      box.style.height = `${it.h * scale}px`;
      closePopup();
      paintPins();
    };
    fit();
    api.command('list_notes', { project: project(), page: pageId(), item: id }).then((list) => mine === shown && ((notes = list), paintPins()), () => {});

    function noteOn(el) {
      popup.compose(under(el.getBoundingClientRect()), (text) =>
        api.command('add_note', { project: project(), page: pageId(), item: id, text, ...describe(el) }).then((note) => mine === shown && (notes.push(note), paintPins())),
      );
    }

    frame.addEventListener('load', () => {
      doc = frame.contentDocument;
      if (!doc) return;
      paintPins();
      let over = null;
      const clear = () => (over?.removeAttribute('data-fr-pick'), (over = null));
      doc.addEventListener('mouseover', (event) => noting && (clear(), (over = event.target).setAttribute('data-fr-pick', '')));
      doc.addEventListener('mouseleave', clear);
      // capture, so in comment mode nothing on the page (a link, a hot control) fires
      doc.addEventListener(
        'click',
        (event) => {
          if (!noting) return;
          event.preventDefault();
          event.stopPropagation();
          clear();
          noteOn(event.target);
        },
        true,
      );
      doc.head.append(Object.assign(doc.createElement('style'), { textContent: '[data-fr-pick]{outline:2px solid rgba(122,31,92,.9)!important;outline-offset:1px;cursor:crosshair}[data-fr-hot]{cursor:pointer}[data-fr-flash] [data-fr-hot]{outline:3px solid rgba(122,31,92,.75);outline-offset:2px;transition:outline-color .6s}' }));
      for (const name of hot.keys()) doc.querySelector(`[data-anchor="${CSS.escape(name)}"],[id="${CSS.escape(name)}"]`)?.setAttribute('data-fr-hot', '');
      doc.addEventListener('click', (event) => {
        for (let el = event.target; el && el !== doc.body; el = el.parentElement) {
          const target = hot.get(el.dataset?.anchor || el.id);
          if (target) {
            event.preventDefault();
            return go(target);
          }
        }
        event.preventDefault();
        doc.body.setAttribute('data-fr-flash', '');
        setTimeout(() => doc.body.removeAttribute('data-fr-flash'), 700);
      });
    });
  }

  comment.addEventListener('click', () => {
    noting = !noting;
    comment.setAttribute('aria-pressed', String(noting));
    closePopup();
  });
  back.addEventListener('click', () => {
    if (trail.length < 2) return;
    trail.pop();
    show(trail.at(-1));
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => (closePopup(), onExit(trail.at(-1))));
  addEventListener('resize', () => dialog.open && fit());

  return {
    // Start at a screen, or with none given, at the flow's entry: an item with arrows out and none in.
    play(id) {
      const arrows = page()?.arrows ?? [];
      const start = id ?? page()?.items.filter((i) => arrows.some((a) => end(a.from) === i.id) && !arrows.some((a) => end(a.to) === i.id)).sort((a, b) => a.y - b.y || a.x - b.x)[0]?.id;
      if (!start || dialog.open) return;
      trail = [];
      dialog.showModal();
      go(start);
    },
  };
}
