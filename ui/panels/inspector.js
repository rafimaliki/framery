// The selection panel: what the selected item is, its description, how it connects, which components
// it is made of, and how to export it. A selected component shows its props and every frame that uses
// it. It shows text from page and library data only; clicking a link selects the thing at the other end.

import { h, icon } from '../core/dom.js';
import { exportControls } from './exporter.js';

const nameOf = (item) => [item.step, item.title ?? item.id].filter(Boolean).join(' ');
const refId = (ref) => ref.split('#')[0];
const EXPORTABLE = new Set(['frame', 'group', 'node', 'table']);

export function createInspector(el, { page, pageId, project, components, onPick, onOpen, onClose, onPlay }) {
  const itemOf = (ref) => page().items.find((i) => i.id === refId(ref));
  const pick = (item) => () => item && onPick({ kind: 'item', id: item.id });

  const chips = (...entries) =>
    h('ul', { class: 'inspector__meta' }, ...entries.filter(Boolean).map((e) => h('li', { class: `chip${e.tone ? ` chip--${e.tone}` : ''}` }, e.text ?? e)));

  // Long descriptions fold to a few lines; the person opens them.
  function text(value, empty) {
    const p = h('p', { class: `inspector__text${value ? '' : ' inspector__text--empty'}` }, value || empty);
    if (!value || value.length < 260) return p;
    p.classList.add('is-folded');
    const toggle = h('button', { class: 'text-btn inspector__more', type: 'button', 'aria-expanded': 'false' }, 'Read more');
    toggle.addEventListener('click', () => {
      const open = p.classList.toggle('is-folded') === false;
      toggle.textContent = open ? 'Show less' : 'Read more';
      toggle.setAttribute('aria-expanded', String(open));
    });
    return h('div', null, p, toggle);
  }

  const section = (title, rows) => (rows.length ? [h('div', { class: 'eyebrow links__head' }, title), h('ul', { class: 'links' }, ...rows)] : null);

  const linkRow = (label, onclick, extra) =>
    h('li', null, h('button', { class: 'link', type: 'button', onclick }, ...label, extra ? h('span', { class: 'link__label' }, extra) : null));

  function connection(arrow, outgoing) {
    const other = itemOf(outgoing ? arrow.to : arrow.from);
    if (!other) return null;
    return linkRow([h('span', { class: 'link__dir' }, outgoing ? '→' : '←'), nameOf(other)], pick(other), arrow.label);
  }

  const exporter = (item) => (EXPORTABLE.has(item.type) ? exportControls({ project: project(), page: pageId(), id: item.id, what: item.type === 'group' ? 'flow' : item.type === 'frame' ? 'screen' : item.type }) : null);

  function itemBody(item) {
    const { arrows, items } = page();
    const out = arrows.filter((a) => refId(a.from) === item.id);
    const into = arrows.filter((a) => refId(a.to) === item.id);
    const inside = items.filter((i) => i.parent === item.id);
    const used = components().filter((c) => c.frames?.some((f) => f.id === item.id));
    const kind = item.type === 'frame' ? item.device ?? 'frame' : item.type === 'node' ? item.shape : item.type;
    const size = item.type === 'group' ? `${inside.length} inside` : item.type === 'table' ? `${item.rows.length} rows × ${item.columns.length} columns` : `${item.w}×${item.h}`;
    return [
      chips(kind, size, { text: item.id }),
      text(item.description, 'No description yet.'),
      item.type === 'frame' && out.length
        ? h('button', { class: 'inspector__open inspector__play', type: 'button', onclick: () => onPlay(item.id) }, h('span', { html: icon.play }), 'Play from here')
        : null,
      item.type === 'frame'
        ? h('a', { class: 'inspector__open', href: `/preview.html?${new URLSearchParams({ project: project(), src: item.src, w: item.w, h: item.h, device: item.device ?? '', title: item.title ?? item.id })}`, target: '_blank', rel: 'noopener' }, 'Open page', h('span', { html: icon.link }))
        : null,
      section('Inside', inside.map((m) => linkRow([nameOf(m)], pick(m)))),
      section('Components', used.map((c) => linkRow([h('span', { class: 'link__dir', html: icon.component }), c.title ?? c.id], () => onPick({ kind: 'component', id: c.id, frame: item.id }), `×${c.frames.find((f) => f.id === item.id).count}`))),
      section('Comes from', into.map((a) => connection(a, false)).filter(Boolean)),
      section('Leads to', out.map((a) => connection(a, true)).filter(Boolean)),
      exporter(item),
    ];
  }

  function arrowBody(arrow) {
    const end = (ref) => linkRow([nameOf(itemOf(ref) ?? { id: ref })], pick(itemOf(ref)), ref.includes('#') ? ref.split('#')[1] : null);
    const tone = arrow.tone ?? 'neutral';
    return [
      chips('arrow', { text: tone, tone }, { text: arrow.id }),
      text(arrow.label, 'No label.'),
      section('From', [end(arrow.from)]),
      section('To', [end(arrow.to)]),
    ];
  }

  // A component: what it is, what it takes, and where it is used. Edit its definition and these all follow.
  function componentBody(c, sel) {
    const props = Object.entries(c.props ?? {}).map(([name, spec]) => {
      const detail = spec.type === 'enum' ? Object.keys(spec.values).join(' | ') : spec.type === 'flag' ? 'on / off' : spec.default ? `“${spec.default.length > 24 ? `${spec.default.slice(0, 24)}…` : spec.default}”` : '';
      return h('li', { class: 'prop' }, h('span', { class: 'prop__name' }, name), h('span', { class: 'prop__type' }, spec.type), detail ? h('span', { class: 'prop__detail' }, detail) : null);
    });
    const home = (c.frames ?? []).find((f) => f.id === `lib-${c.id}`);
    const here = (c.frames ?? []).find((f) => f.id === sel.frame)?.instances?.[sel.at ?? -1]?.props;
    const given = Object.entries(here ?? {}).filter(([, v]) => v !== '');
    const onSheet = page().items.find((i) => i.id === sel.frame)?.src?.startsWith('components/lib-');
    return [
      chips('component', ...(onSheet ? [`${c.uses} ${c.uses === 1 ? 'use' : 'uses'}`] : []), { text: c.id }),
      text(c.description, 'No description yet.'),
      // the instance that was clicked: what it sets
      given.length ? [h('div', { class: 'eyebrow links__head' }, 'This one'), h('ul', { class: 'props' }, ...given.map(([k, v]) => h('li', { class: 'prop' }, h('span', { class: 'prop__name' }, k), h('span', { class: 'prop__detail' }, v.length > 60 ? `${v.slice(0, 60)}…` : v))))] : null,
      props.length ? [h('div', { class: 'eyebrow links__head' }, 'Props'), h('ul', { class: 'props' }, ...props)] : null,
      // Where a component is used is the design system's business: on a flow it only points there.
      onSheet ? section('Used in', (c.frames ?? []).map((f) => linkRow([f.title ?? f.file ?? f.id], () => (f.id ? onOpen(f.page, f.id) : null), f.count > 1 ? `×${f.count}` : null))) : home ? section('Defined in', [linkRow(['Design system'], () => onOpen(home.page, home.id))]) : null,
    ];
  }

  let shownKey = null; // what the open panel shows: the same subject again is a refresh, not an entrance

  return {
    show(sel) {
      const isArrow = sel.kind === 'arrow';
      const isComponent = sel.kind === 'component';
      const component = isComponent ? components().find((c) => c.id === sel.id) : null;
      const subject = isComponent ? component : isArrow ? page().arrows.find((a) => a.id === sel.id) : page().items.find((i) => i.id === sel.id);
      if (!subject) return this.hide();
      const title = isComponent ? subject.title ?? subject.id : isArrow ? [subject.from, subject.to].map((ref) => itemOf(ref)?.title ?? refId(ref)).join(' → ') : subject.title ?? subject.id;
      const body = isComponent ? componentBody(subject, sel) : isArrow ? arrowBody(subject) : itemBody(subject);
      const wasHidden = el.hidden;
      const key = [sel.kind, sel.frame, sel.id, sel.at].join(':');
      const refresh = !wasHidden && key === shownKey;
      const scroll = refresh ? el.querySelector('.inspector__body')?.scrollTop ?? 0 : 0;
      shownKey = key;
      el.hidden = false;
      el.replaceChildren(
        h(
          'div',
          { class: 'inspector__head' },
          h('h2', { class: 'inspector__title' }, !isArrow && !isComponent && subject.step ? h('span', { class: 'inspector__step' }, `${subject.step} `) : null, title),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: onClose, html: icon.close }),
        ),
        h('div', { class: 'inspector__body' }, ...body.flat().filter(Boolean)),
      );
      if (refresh) {
        const next = el.querySelector('.inspector__body');
        next.style.animation = 'none';
        next.scrollTop = scroll;
      }
      if (wasHidden) {
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
      }
    },
    hide() {
      el.hidden = true;
    },
  };
}
