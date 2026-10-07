// Play a flow as a prototype: one screen at a time, live, and a click on a control that an arrow starts
// from goes where the arrow goes. A click anywhere else flashes what can be clicked. A diamond on the way
// is asked as a question, one button per answer; arrows that start on no control (a timeout, a failed
// sign-in) are buttons under the screen. Back, Esc, and the canvas follows to the last screen played.

import { api } from '../core/api.js';
import { h, icon } from '../core/dom.js';

const end = (ref) => ref.split('#')[0];
const element = (ref) => ref.split('#')[1] ?? null;
const PAD = 48; // room around the screen inside the stage

export function createPlayer({ project, page, rev, onExit }) {
  const title = h('h2', { class: 'player__title' });
  const back = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back', title: 'Back', html: icon.back });
  const close = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Stop playing', title: 'Stop playing (Esc)', html: icon.close });
  const stage = h('div', { class: 'player__stage' });
  const ways = h('div', { class: 'player__ways' });
  const dialog = h('dialog', { class: 'player', 'aria-label': 'Play the flow' }, h('header', { class: 'player__head' }, back, title, close), stage, ways);
  document.body.append(dialog);
  let trail = []; // ids played, the last one showing
  let fit = () => {};

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
    back.disabled = trail.length < 2;
    title.replaceChildren(...(it?.step ? [h('span', { class: 'inspector__step' }, `${it.step} `)] : []), it?.title ?? id);
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
    const box = h('div', { class: 'player__screen' }, frame);
    stage.replaceChildren(box);
    fit = () => {
      const s = Math.min(1, (stage.clientWidth - PAD) / it.w, (stage.clientHeight - PAD) / it.h);
      frame.style.transform = `scale(${s})`;
      box.style.width = `${it.w * s}px`;
      box.style.height = `${it.h * s}px`;
    };
    fit();
    frame.addEventListener('load', () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      doc.head.append(Object.assign(doc.createElement('style'), { textContent: '[data-fr-hot]{cursor:pointer}[data-fr-flash] [data-fr-hot]{outline:3px solid rgba(239,75,35,.75);outline-offset:2px;transition:outline-color .6s}' }));
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

  back.addEventListener('click', () => {
    if (trail.length < 2) return;
    trail.pop();
    show(trail.at(-1));
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => onExit(trail.at(-1)));
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
