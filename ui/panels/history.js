// The history popover: what each prompt changed, newest first, and a way back. The server keeps the
// trail (src/history.mjs); this panel lists it and asks for a restore. Going back is two clicks, the
// second one a confirmation, and the restore is itself an entry, so it can be undone from here too.

import { h, icon } from '../core/dom.js';
import { bus } from '../core/bus.js';

const ago = (time) => {
  const s = Math.max(0, (Date.now() - time) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const name = (path) => path.split('/').pop();

function summary(entry) {
  if (entry.kind === 'baseline') return entry.label ?? 'Before history began';
  if (entry.label) return entry.label;
  return entry.tools.join(', ');
}

export function createHistory({ button, panel }, { project, list, restore }) {
  button.innerHTML = icon.history;
  let entries = [];
  let asked = null; // the entry whose restore is waiting for its second click
  let timer = null;

  const row = (entry, before) => {
    const files = entry.files.map((f) => name(f.path));
    const detail = entry.kind === 'baseline' ? `${files.length} files` : `${files.slice(0, 3).join(', ')}${files.length > 3 ? ` +${files.length - 3}` : ''}`;
    const go = before && h('button', { class: 'text-btn history__go', type: 'button', onclick: () => ask(entry, before) }, asked === entry.n ? 'Confirm' : 'Go back before this');
    return h(
      'li',
      { class: `history__row${asked === entry.n ? ' is-asked' : ''}`, title: entry.files.map((f) => `${f.change} ${f.path}`).join('\n') },
      h('div', { class: 'history__top' }, h('span', { class: 'history__what' }, summary(entry)), h('span', { class: 'history__when' }, ago(entry.last))),
      h('div', { class: 'history__files' }, detail),
      go,
    );
  };

  function draw() {
    const rows = entries.map((entry, i) => row(entry, entries[i + 1]));
    panel.replaceChildren(
      h('div', { class: 'eyebrow' }, 'History'),
      rows.length > 1 ? h('ul', { class: 'history__list' }, ...rows) : h('p', { class: 'settings__hint' }, 'Nothing has changed yet. Each prompt that edits the design shows up here, and can be undone.'),
    );
  }

  async function load() {
    if (!project()) return;
    entries = await list(project());
    draw();
  }

  async function ask(entry, before) {
    if (asked !== entry.n) {
      asked = entry.n;
      clearTimeout(timer);
      timer = setTimeout(() => ((asked = null), draw()), 3500);
      return draw();
    }
    asked = null;
    clearTimeout(timer);
    await restore(project(), before.n);
    await load();
  }

  const set = (open) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) load().catch(() => {});
    else asked = null;
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    set(panel.hidden);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) set(false);
  });
  document.addEventListener('keydown', (event) => event.key === 'Escape' && !panel.hidden && set(false));
  bus.on('history', () => !panel.hidden && load().catch(() => {}));
  return { close: () => set(false) };
}
