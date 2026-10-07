// Find anything on any page of the project: `/` or Ctrl+K opens it, typing narrows it, the arrow keys
// and Enter (or a click) go there. Pages are read when it opens, so it always searches what is on disk.

import { api } from '../core/api.js';
import { h } from '../core/dom.js';

const LIMIT = 50;

export function createFinder({ project, pages, onGo }) {
  const input = h('input', { class: 'finder__input', type: 'search', placeholder: 'Find a screen, group or node on any page', 'aria-label': 'Find on any page', autocomplete: 'off' });
  const list = h('ul', { class: 'finder__list', role: 'listbox', 'aria-label': 'Matches' });
  const dialog = h('dialog', { class: 'finder', 'aria-label': 'Find' }, input, list);
  dialog.addEventListener('click', (event) => event.target === dialog && dialog.close()); // a click on the backdrop
  document.body.append(dialog);
  let all = []; // { page, pageTitle, item }
  let hits = [];
  let at = 0;

  async function load() {
    const name = project();
    const each = await Promise.all(
      pages().map((p) =>
        api
          .page(name, p.id)
          .then((data) => (data.items ?? []).map((item) => ({ page: p.id, pageTitle: p.title ?? p.id, item })))
          .catch(() => []),
      ),
    );
    all = each.flat();
  }

  function paint() {
    const q = input.value.trim().toLowerCase();
    const has = (text) => !!text && text.toLowerCase().includes(q);
    // a match in the name before one only in the description
    hits = q
      ? all
          .filter(({ item }) => [item.title, item.id, item.step, item.description].some(has))
          .sort((a, b) => Number(!(has(a.item.title) || has(a.item.id))) - Number(!(has(b.item.title) || has(b.item.id))))
      : all;
    hits = hits.slice(0, LIMIT);
    at = Math.min(at, Math.max(0, hits.length - 1));
    list.replaceChildren(
      ...(hits.length
        ? hits.map(({ pageTitle, item }, i) =>
            h(
              'li',
              { class: 'finder__hit', role: 'option', 'aria-selected': String(i === at), onclick: () => go(i) },
              item.step ? h('span', { class: 'layer__tag' }, item.step) : null,
              h('span', { class: 'finder__title' }, item.title ?? item.id),
              h('span', { class: 'finder__page' }, pageTitle),
            ),
          )
        : [h('li', { class: 'finder__none' }, 'Nothing matches.')]),
    );
    list.children[at]?.scrollIntoView({ block: 'nearest' });
  }

  function go(i) {
    const hit = hits[i];
    if (!hit) return;
    dialog.close();
    onGo(hit.page, hit.item.id);
  }

  input.addEventListener('input', () => {
    at = 0;
    paint();
  });
  input.addEventListener('keydown', (event) => {
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (move) {
      event.preventDefault();
      at = (at + move + hits.length) % Math.max(1, hits.length);
      paint();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(at);
    }
  });

  return {
    async open() {
      if (dialog.open || !project()) return;
      input.value = '';
      at = 0;
      await load();
      paint();
      dialog.showModal();
      input.focus();
    },
  };
}
