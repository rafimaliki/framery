// The layer list: groups with their frames beneath, filterable, and each group collapsible. Clicking a
// layer selects it and the canvas flies there. It renders from page data and never touches the canvas.
// Which groups are open is remembered per page; a long page starts collapsed, a short one open.

import { h, icon } from '../core/dom.js';

const COLLAPSE_ABOVE = 4; // more groups than this and the list starts folded
const glyph = (item) => {
  if (item.type === 'group') return icon.group;
  if (item.type === 'node') return icon[item.shape] ?? icon.node;
  if (item.type === 'table') return icon.plan;
  if (item.device === 'document') return icon.page; // a gallery or a spec page, not a screen of any device
  return !item.device || item.device === 'phone' ? icon.frame : icon.desktop;
};

export function createLayers({ box, list, search, toggleAll }, { onPick }) {
  let page = null;
  let key = null;
  let selected = null;
  let open = new Set(); // ids of expanded groups
  const parentOf = new Map();
  let byFrame = new Map(); // frame id -> the components it uses: [{ id, title, count }]
  const rowId = (frame, component, at) => `${frame}:${component}:${at ?? ''}`;

  const storeKey = () => `framery.layers.${key}`;
  const remember = () => {
    try {
      localStorage.setItem(storeKey(), JSON.stringify([...open]));
    } catch {
      // not remembered, nothing lost
    }
  };
  function restore() {
    const groups = page.items.filter((i) => i.type === 'group');
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey()) ?? 'null');
      if (Array.isArray(saved)) return new Set(saved);
    } catch {
      // fall through to the default
    }
    return new Set(groups.length > COLLAPSE_ABOVE ? [] : groups.map((g) => g.id));
  }

  const matches = (item, q) => !q || [item.title, item.id, item.step, item.description].some((text) => text?.toLowerCase().includes(q));
  const visible = (id, q) => {
    if (q) return true; // a filter shows what it finds, folded or not
    for (let up = parentOf.get(id); up; up = parentOf.get(up)) if (!open.has(up)) return false;
    return true;
  };

  // A component a frame uses: a row under the frame, folded by default.
  function componentRow(frame, comp, depth, index) {
    const id = rowId(frame.id, comp.id, comp.at);
    const pick = h(
      'button',
      { class: 'layer layer--child layer--component', type: 'button', 'data-id': id, 'aria-selected': String(id === selected), onclick: () => onPick({ kind: 'component', id: comp.id, frame: frame.id, at: comp.at }) },
      h('span', { html: icon.component }),
      h('span', { class: 'layer__title' }, comp.title),
      comp.hint ? h('span', { class: 'layer__tag' }, comp.hint) : null,
    );
    const li = h('li', { class: 'layer-row layer-row--leaf layer-row--component', 'data-id': id });
    li.style.setProperty('--i', index);
    li.style.setProperty('--depth', depth);
    li.append(pick);
    return li;
  }

  function row(item, depth, index) {
    const pick = h(
      'button',
      {
        class: `layer${depth ? ' layer--child' : ''}`,
        type: 'button',
        'data-id': item.id,
        'aria-selected': String(item.id === selected),
        onclick: () => onPick({ kind: 'item', id: item.id }),
      },
      h('span', { html: glyph(item) }),
      item.step ? h('span', { class: 'layer__tag' }, item.step) : null,
      h('span', { class: 'layer__title' }, item.title ?? item.id),
    );
    const li = h('li', { class: 'layer-row', 'data-id': item.id });
    li.style.setProperty('--i', index);
    li.style.setProperty('--depth', depth); // each level sits one tab in from the one above
    if (item.type === 'group' || byFrame.has(item.id)) {
      const caret = h('button', { class: 'caret', type: 'button', 'aria-label': `Toggle ${item.title ?? item.id}`, 'aria-expanded': String(open.has(item.id)), html: icon.caret, onclick: () => toggle(item.id) });
      li.append(caret);
    } else li.classList.add('layer-row--leaf');
    li.append(pick);
    return li;
  }

  function render() {
    if (!page) return list.replaceChildren();
    const q = search.value.trim().toLowerCase();
    const rows = [];
    let n = 0;
    const walk = (parent, depth) => {
      const kids = page.items.filter((i) => (i.parent ?? null) === parent).sort((a, b) => a.y - b.y || a.x - b.x);
      for (const item of kids) {
        const holdsMatch = item.type === 'group' && page.items.some((i) => i.parent === item.id && matches(i, q));
        const uses = byFrame.get(item.id) ?? [];
        const usesMatch = uses.some((c) => matches(c, q));
        if (matches(item, q) || holdsMatch || usesMatch) rows.push(row(item, depth, n++));
        if (item.type === 'group') walk(item.id, depth + 1);
        for (const comp of uses) {
          if (!matches(comp, q) && !matches(item, q)) continue;
          parentOf.set(rowId(item.id, comp.id, comp.at), item.id);
          rows.push(componentRow(item, comp, depth + 1, n++));
        }
      }
    };
    walk(null, 0);
    list.replaceChildren(...(rows.length ? rows : [h('li', { class: 'layers__none' }, 'Nothing matches.')]));
    apply();
  }

  // Show or hide rows to match what is open, without rebuilding the list or losing the scroll position.
  function apply() {
    const q = search.value.trim().toLowerCase();
    for (const li of list.querySelectorAll('.layer-row')) {
      li.hidden = !visible(li.dataset.id, q);
      const caret = li.querySelector(':scope > .caret');
      if (caret) {
        const on = q ? true : open.has(li.dataset.id);
        caret.setAttribute('aria-expanded', String(on));
        caret.classList.toggle('is-open', on);
      }
    }
    const groups = page ? page.items.filter((i) => i.type === 'group') : [];
    toggleAll.hidden = !groups.length;
    const allOpen = groups.every((g) => open.has(g.id));
    toggleAll.textContent = allOpen ? 'Collapse all' : 'Expand all';
  }

  function toggle(id) {
    if (open.has(id)) open.delete(id);
    else open.add(id);
    remember();
    apply();
  }

  search.addEventListener('input', render);
  toggleAll.addEventListener('click', () => {
    const groups = page.items.filter((i) => i.type === 'group');
    open = groups.every((g) => open.has(g.id)) ? new Set() : new Set(groups.map((g) => g.id));
    remember();
    apply();
  });

  return {
    // The library changed, or a frame did: rebuild the rows that show which components a frame uses.
    setComponents(components) {
      byFrame = new Map();
      // One row per instance, in the order they sit in the frame, each named by what sets it apart.
      for (const c of components) {
        for (const f of c.frames ?? []) {
          if (!f.id || !page?.items.some((i) => i.id === f.id)) continue;
          const list = byFrame.get(f.id) ?? [];
          (f.instances ?? []).forEach(({ seq, props }, at) => {
            const hint = props.label ?? props.active ?? props.variant ?? props.date ?? '';
            list.push({ id: c.id, title: c.title ?? c.id, hint, at, seq });
          });
          byFrame.set(f.id, list);
        }
      }
      for (const list of byFrame.values()) list.sort((a, b) => a.seq - b.seq);
      if (page) render();
    },
    show(next, pageKey) {
      const fresh = pageKey !== key;
      page = next;
      key = pageKey;
      parentOf.clear();
      for (const item of page.items) if (item.parent) parentOf.set(item.id, item.parent);
      if (fresh) open = restore();
      box.hidden = false;
      render();
    },
    hide() {
      page = null;
      box.hidden = true;
    },
    // A selection made elsewhere (the canvas) opens the groups above it so it can be seen.
    select(sel) {
      selected = sel?.kind === 'item' ? sel.id : sel?.kind === 'component' ? rowId(sel.frame, sel.id, sel.at) : null;
      let changed = false;
      for (let up = parentOf.get(selected); up; up = parentOf.get(up)) if (!open.has(up)) (open.add(up), (changed = true));
      if (changed) {
        remember();
        apply();
      }
      for (const button of list.querySelectorAll('.layer')) {
        const on = button.dataset.id === selected;
        button.setAttribute('aria-selected', String(on));
        if (on) button.scrollIntoView({ block: 'nearest' });
      }
    },
  };
}
