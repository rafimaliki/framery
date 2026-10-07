// The one command surface. The MCP server, the HTTP API and the CLI all call run(); each entry
// carries its own description and input schema, so the tool list an agent sees is this table.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { checkName, fail } from './store.mjs';
import { DEVICES, arrange, find, fitGroup, layoutFlow, members, outline, place, refElement, refItem, withMembers } from './layout.mjs';
import * as tables from './tables.mjs';
import { cmd, project, t, where } from './kit.mjs';
import { componentCommands } from './commands-components.mjs';
import { historyCommands } from './commands-history.mjs';
import { begin, record, snapshot } from './history.mjs';
import { checkArrows } from '../ui/canvas/check.js';

const TYPES = ['frame', 'group', 'node', 'table'];
const SHAPES = { terminal: [160, 56], process: [180, 72], diamond: [200, 120] };
const TONES = ['neutral', 'positive', 'negative'];
const SIDES = ['top', 'right', 'bottom', 'left'];
const ITEM_KEYS = ['id', 'type', 'x', 'y', 'w', 'h', 'title', 'step', 'description', 'src', 'device', 'shape', 'parent', 'autoHeight', 'sizes', 'columns', 'rows', 'marks'];
const ARROW_KEYS = ['id', 'from', 'to', 'label', 'tone', 'fromSide', 'toSide'];

// Where the studio runs: the address the server wrote when it started, while that process is alive.
function studioUrl(store) {
  try {
    const { url, pid } = JSON.parse(readFileSync(`${store.root}/.cache/studio.json`, 'utf8'));
    process.kill(pid, 0);
    return url;
  } catch {
    return 'http://127.0.0.1:4173';
  }
}

// ---- pages ---------------------------------------------------------------------------------------

function pageId(store, project, wanted) {
  if (wanted) return checkName('page', wanted);
  const pages = store.project(project).pages ?? [];
  if (pages.length === 1) return pages[0].id;
  fail(`say which page: ${pages.map((p) => p.id).join(', ')}`);
}

export function anchorsOf(store, project, frame) {
  const file = store.inside(project, frame.src);
  const html = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const ids = new Set();
  for (const match of html.matchAll(/\b(?:data-anchor|id)="([^"]+)"/g)) ids.add(match[1]);
  return [...ids];
}

function validate(store, project, page) {
  for (const item of page.items) {
    if (item.sizes === undefined) continue;
    if (item.type !== 'frame' || !Array.isArray(item.sizes)) fail(`${item.id}: sizes is a list of device sizes, frames only`);
    for (const size of item.sizes) if (!DEVICES[size]) fail(`${item.id}: size ${size} is not one of ${Object.keys(DEVICES).join(', ')}`);
    if (new Set(item.sizes).size !== item.sizes.length || item.sizes.includes(item.device)) fail(`${item.id}: each size once, and not the frame's own device`);
  }
  const ids = new Set();
  for (const item of page.items) {
    if (ids.has(item.id)) fail(`duplicate id ${item.id}`);
    ids.add(item.id);
  }
  for (const item of page.items) {
    let up = item;
    for (let hops = 0; up.parent; hops++) {
      up = find(page, up.parent);
      if (up.type !== 'group') fail(`${item.id}: parent ${up.id} is not a group`);
      if (hops > 20 || up === item) fail(`${item.id}: parent cycle`);
    }
  }
  const arrows = new Set();
  for (const arrow of page.arrows) {
    if (arrows.has(arrow.id)) fail(`duplicate arrow id ${arrow.id}`);
    arrows.add(arrow.id);
    for (const end of ['from', 'to']) {
      const item = find(page, refItem(arrow[end]));
      const element = refElement(arrow[end]);
      if (!element) continue;
      if (item.type !== 'frame') fail(`${arrow[end]}: only a frame has elements`);
      const have = anchorsOf(store, project, item);
      if (!have.includes(element)) {
        fail(`${arrow[end]}: no element "${element}" in ${item.src}. Give it id="${element}" or data-anchor="${element}". Found: ${have.slice(0, 40).join(', ') || 'none'}`);
      }
    }
  }
}

function edit(store, args, change) {
  const project = store.name(args.project);
  const id = pageId(store, project, args.page);
  const page = store.page(project, id);
  page.items ??= [];
  page.arrows ??= [];
  const result = change(page, project);
  validate(store, project, page);
  store.savePage(project, id, page);
  return { page: id, ...result };
}

function pick(source, keys, what) {
  for (const key of Object.keys(source)) if (!keys.includes(key)) fail(`${what}: unknown field "${key}"; allowed: ${keys.join(', ')}`);
  return source;
}

function unique(taken, base) {
  const slug = String(base ?? 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  let id = slug;
  for (let n = 2; taken.has(id); n++) id = `${slug}-${n}`;
  return id;
}

// Run one edit on a table item and say what came out: the table's new size, so the caller sees the result.
function tableEdit(page, id, change, result) {
  const table = find(page, id);
  if (table.type !== 'table') fail(`${id} is a ${table.type}, not a table`);
  change(table);
  return { ...result, table: { id, w: table.w, h: table.h, rows: table.rows.length, columns: table.columns.length } };
}

// A table row may link to something on a page ("flows/6_entry"): the studio opens it on click. A link
// to nothing is a broken promise, so it is refused here.
function checkLinks(store, project, table) {
  for (const row of table.rows) {
    if (!row.link) continue;
    const [pageName, id] = String(row.link).split('/');
    const target = (store.project(project).pages ?? []).some((p) => p.id === pageName) ? store.page(project, pageName) : null;
    if (!target) fail(`row ${row.id}: link ${row.link} names no page`);
    if (id && !target.items.some((i) => i.id === id)) fail(`row ${row.id}: link ${row.link} names no item`);
  }
}

function build(store, project, page, input) {
  const item = pick({ ...input }, ITEM_KEYS, 'item');
  if (!TYPES.includes(item.type)) fail(`type must be one of ${TYPES.join(', ')}`);
  item.id = item.id ? checkName('id', item.id) : unique(new Set(page.items.map((i) => i.id)), item.title ?? item.type);
  if (item.type === 'frame') {
    if (!item.src) fail('a frame needs src: an html file inside the project');
    if (!existsSync(store.inside(project, item.src))) fail(`no file ${item.src} in the project`);
    if (!item.device) fail(`a frame needs device: phone, tablet or desktop for a real screen, document for anything else (a spec, a gallery), or any name with w and h`);
    if (item.device === 'document' && !item.h) item.autoHeight ??= true;
    if (!DEVICES[item.device] && !(item.w && item.h)) fail(`device ${item.device} needs w and h (presets: ${Object.keys(DEVICES).join(', ')})`);
    const [w, h] = DEVICES[item.device] ?? [0, 0];
    item.w ??= w;
    item.h ??= h;
  } else if (item.type === 'node') {
    item.shape ??= 'process';
    if (!SHAPES[item.shape]) fail(`shape must be one of ${Object.keys(SHAPES).join(', ')}`);
    item.w ??= SHAPES[item.shape][0];
    item.h ??= SHAPES[item.shape][1];
  } else if (item.type === 'table') {
    tables.fit(item);
    checkLinks(store, project, item);
  } else {
    item.w ??= 400;
    item.h ??= 300;
  }
  return item;
}

// ---- tokens --------------------------------------------------------------------------------------

const tokenFile = (store, project) => store.inside(project, store.project(project).tokens ?? 'tokens.css');

const tokens = (css) => [...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => ({ name: m[1], value: m[2].trim() }));

// ---- schema ----------------------------------------------------------------------------------------

const itemProps = {
  type: t.one(TYPES, 'frame = a screen from an html file; group = a container; node = a flowchart shape; table = rows and columns (a plan, a matrix)'),
  id: t.str('stable id; made from the title when omitted'),
  title: t.str('short label'),
  step: t.str('optional step tag shown before the title, e.g. "5.1"'),
  description: t.str('what this is and the rules it keeps; shown when the item is clicked'),
  x: t.num('world x; omitted = placed to the right of its neighbours'),
  y: t.num('world y'),
  w: t.num('width; defaults from device or shape'),
  h: t.num('height; defaults from device or shape'),
  src: t.str('frame only: html path inside the project'),
  device: t.str(`frame only, required: phone, tablet or desktop for a real screen of that device; document for anything else (a spec, a gallery), auto height; or any name with w and h`),
  shape: t.one(Object.keys(SHAPES), 'node only'),
  parent: t.str('id of the group this item sits in'),
  autoHeight: t.bool('frame only: render_frames re-measures its height from the page'),
  sizes: { type: 'array', items: { type: 'string' }, description: `frame only: other device sizes the same page must work at (${Object.keys(DEVICES).join(', ')}); check_design checks each, the player shows each` },
  columns: { type: 'array', items: { type: 'object' }, description: 'table only: [{id, title, note?}]; the width follows the count' },
  rows: { type: 'array', items: { type: 'object' }, description: 'table only: [{id, title, link?: "page/item", cells: {columnId: text}}]; the height follows the count' },
  marks: { type: 'object', description: `table only: cell text drawn as a pill, e.g. {"built": "positive"}; styles ${tables.MARK_STYLES.join(', ')}` },
};
const arrowProps = {
  label: t.str('the action that takes the user along this arrow'),
  tone: t.one(TONES, 'positive = green, negative = red, neutral = grey'),
  fromSide: t.one(SIDES, 'optional; chosen from positions when omitted'),
  toSide: t.one(SIDES, 'optional'),
};
const ends = { from: t.str('item id or item#element'), to: t.str('item id or item#element') };

// ---- the table -----------------------------------------------------------------------------------

export const commands = {
  list_projects: cmd('List the projects in the data root.', {}, [], (store) => store.projects()),

  get_project: cmd('Project settings and its pages with item and arrow counts.', { project }, [], (store, a) => {
    const name = store.name(a.project);
    const info = store.project(name);
    const pages = (info.pages ?? []).map((p) => {
      const data = store.page(name, p.id);
      return { ...p, items: data.items?.length ?? 0, arrows: data.arrows?.length ?? 0 };
    });
    return { name, ...info, pages };
  }),

  get_page: cmd('The full JSON of one page: items (frames, groups, nodes) and arrows.', where, [], (store, a) => {
    const name = store.name(a.project);
    return store.page(name, pageId(store, name, a.page));
  }),

  outline: cmd(
    'A page as readable text, in reading order: groups, frames with descriptions, and where each arrow leads. Start here to understand a flow.',
    where,
    [],
    (store, a) => {
      const name = store.name(a.project);
      return outline(store.page(name, pageId(store, name, a.page)));
    },
  ),

  add_item: cmd(
    'Add a frame, group or flowchart node. Without x and y it lands right of its neighbours; with a parent the group grows to hold it.',
    { ...where, ...itemProps },
    ['type'],
    (store, a) => {
      const { project: _project, page: _page, ...input } = a;
      return edit(store, a, (page, name) => {
        const item = build(store, name, page, input);
        if (item.parent) find(page, item.parent);
        place(page, item);
        page.items.push(item);
        if (item.parent) fitGroup(page, item.parent);
        return { item };
      });
    },
  ),

  update_item: cmd(
    'Change fields of an item. Moving a group moves what is inside it.',
    { ...where, id: t.str('item id'), patch: { type: 'object', properties: itemProps, description: 'fields to change' } },
    ['id', 'patch'],
    (store, a) =>
      edit(store, a, (page, name) => {
        const item = find(page, a.id);
        const patch = pick({ ...a.patch }, ITEM_KEYS, 'patch');
        delete patch.id;
        delete patch.type;
        const was = item.parent;
        const dx = (patch.x ?? item.x) - item.x;
        const dy = (patch.y ?? item.y) - item.y;
        delete patch.x;
        delete patch.y;
        Object.assign(item, patch);
        for (const key of Object.keys(item)) if (item[key] === null || item[key] === '') delete item[key];
        if (item.type === 'table') {
          tables.fit(item);
          checkLinks(store, name, item);
        }
        for (const part of withMembers(page, [item.id])) {
          part.x += dx;
          part.y += dy;
        }
        for (const parent of new Set([was, item.parent].filter(Boolean))) fitGroup(page, parent);
        return { item };
      }),
  ),

  remove_item: cmd(
    'Remove an item and the arrows touching it. A group keeps its members unless members is true.',
    { ...where, id: t.str('item id'), members: t.bool('also remove what is inside a group') },
    ['id'],
    (store, a) =>
      edit(store, a, (page) => {
        const item = find(page, a.id);
        const gone = new Set(a.members ? withMembers(page, [a.id]).map((i) => i.id) : [a.id]);
        for (const child of members(page, a.id)) {
          if (gone.has(child.id)) continue;
          if (item.parent) child.parent = item.parent;
          else delete child.parent;
        }
        page.items = page.items.filter((i) => !gone.has(i.id));
        const before = page.arrows.length;
        page.arrows = page.arrows.filter((r) => !gone.has(refItem(r.from)) && !gone.has(refItem(r.to)));
        if (item.parent) fitGroup(page, item.parent);
        return { removed: [...gone], arrowsRemoved: before - page.arrows.length };
      }),
  ),

  move_items: cmd(
    'Move items by dx, dy (world units). A group takes its members along.',
    { ...where, ids: t.ids, dx: t.num('right'), dy: t.num('down') },
    ['ids'],
    (store, a) =>
      edit(store, a, (page) => {
        const moved = withMembers(page, a.ids);
        for (const item of moved) {
          item.x += a.dx ?? 0;
          item.y += a.dy ?? 0;
        }
        for (const parent of new Set(a.ids.map((id) => find(page, id).parent).filter(Boolean))) fitGroup(page, parent);
        return { moved: moved.map((i) => i.id) };
      }),
  ),

  rename_item: cmd(
    'Give an item a new id, safely: what is inside it, its arrows (anchors kept), table links to it on any page and its cached preview follow.',
    { ...where, id: t.str('current item id'), to: t.str('new id') },
    ['id', 'to'],
    (store, a) => {
      const name = store.name(a.project);
      const here = pageId(store, name, a.page);
      const to = checkName('id', a.to);
      const page = store.page(name, here);
      const item = find(page, a.id);
      if (page.items.some((i) => i.id === to)) fail(`id ${to} is taken on ${here}`);
      const from = item.id;
      item.id = to;
      for (const i of page.items) if (i.parent === from) i.parent = to;
      const re = (ref) => (refItem(ref) === from ? to + ref.slice(from.length) : ref);
      let arrows = 0;
      for (const r of page.arrows ?? []) {
        const [f, t] = [re(r.from), re(r.to)];
        if (f !== r.from || t !== r.to) arrows++;
        [r.from, r.to] = [f, t];
      }
      // a table row on any page may link here ("page/id")
      const pages = new Map([[here, page]]);
      let links = 0;
      for (const { id } of store.project(name).pages ?? []) {
        const other = pages.get(id) ?? store.page(name, id);
        for (const row of (other.items ?? []).filter((i) => i.type === 'table').flatMap((i) => i.rows ?? [])) {
          if (row.link === `${here}/${from}`) {
            row.link = `${here}/${to}`;
            pages.set(id, other);
            links++;
          }
        }
      }
      for (const p of pages.values()) validate(store, name, p);
      for (const [id, p] of pages) store.savePage(name, id, p);
      for (const [dir, ext] of [['frames', 'webp'], ['anchors', 'json']]) {
        const old = store.inside(name, `.cache/${dir}/${from}.${ext}`);
        if (existsSync(old)) renameSync(old, store.inside(name, `.cache/${dir}/${to}.${ext}`));
      }
      return { page: here, from, to, arrows, links };
    },
  ),

  move_to_page: cmd(
    'Move items to another page; a group takes its members along. Arrows between moved items go with them; an arrow that would cross pages is refused. dx, dy shift them on the way.',
    { ...where, ids: t.ids, to: t.str('target page id'), dx: t.num('right'), dy: t.num('down') },
    ['ids', 'to'],
    (store, a) => {
      const name = store.name(a.project);
      const from = pageId(store, name, a.page);
      const to = checkName('page', a.to);
      if (to === from) fail(`the items are already on ${to}`);
      if (!(store.project(name).pages ?? []).some((p) => p.id === to)) fail(`no page ${to}`);
      const source = store.page(name, from);
      const target = store.page(name, to);
      source.items ??= [];
      source.arrows ??= [];
      target.items ??= [];
      target.arrows ??= [];
      const moved = withMembers(source, a.ids);
      const ids = new Set(moved.map((i) => i.id));
      const crossing = source.arrows.filter((r) => ids.has(refItem(r.from)) !== ids.has(refItem(r.to)));
      if (crossing.length) fail(`arrows would cross pages: ${crossing.map((r) => r.id).join(', ')}; remove them or move both ends`);
      const arrows = source.arrows.filter((r) => ids.has(refItem(r.from)));
      const clash = [...moved.filter((i) => target.items.some((x) => x.id === i.id)), ...arrows.filter((r) => target.arrows.some((x) => x.id === r.id))];
      if (clash.length) fail(`ids already on ${to}: ${clash.map((i) => i.id).join(', ')}`);
      const left = new Set();
      for (const item of moved) {
        item.x += a.dx ?? 0;
        item.y += a.dy ?? 0;
        if (item.parent && !ids.has(item.parent)) {
          left.add(item.parent);
          delete item.parent;
        }
      }
      source.items = source.items.filter((i) => !ids.has(i.id));
      source.arrows = source.arrows.filter((r) => !arrows.includes(r));
      target.items.push(...moved);
      target.arrows.push(...arrows);
      for (const parent of left) if (members(source, parent).length) fitGroup(source, parent);
      validate(store, name, source);
      validate(store, name, target);
      store.savePage(name, from, source);
      store.savePage(name, to, target);
      return { page: from, to, moved: [...ids], arrows: arrows.map((r) => r.id) };
    },
  ),

  layout_flow: cmd(
    'Lay a flow out from its arrows, instead of placing items by hand: the happy path in one row (positive arrows first at a branch), every state or failure directly under the screen it belongs to. Give a group (its members are laid out and it is refit) or ids. Returns what check_arrows then says, which should be nothing.',
    { ...where, group: t.str('lay out the members of this group'), ids: t.ids, gap: t.num('between columns, default 140'), rowGap: t.num('between rows, default 160'), x: t.num('left edge; default where the items are'), y: t.num('top edge') },
    [],
    async (store, a) => {
      if (!a.group === !a.ids) fail('give a group or ids, not both');
      const out = edit(store, a, (page) => {
        const ids = a.group ? (find(page, a.group), members(page, a.group).map((i) => i.id)) : a.ids;
        if (!ids.length) fail(`group ${a.group} is empty`);
        return { moved: layoutFlow(page, ids, a).map((i) => i.id) };
      });
      return { ...out, ...(await commands.check_arrows.run(store, { project: a.project, page: out.page })) };
    },
  ),

  arrange: cmd(
    'Lay items out in a row or a column, in the order given, with an even gap.',
    { ...where, ids: t.ids, direction: t.one(['row', 'column'], 'default row'), gap: t.num('default 120'), x: t.num('start x'), y: t.num('start y'), align: t.one(['start', 'center'], 'cross-axis alignment') },
    ['ids'],
    (store, a) => edit(store, a, (page) => ({ items: arrange(page, a.ids, a).map(({ id, x, y }) => ({ id, x, y })) })),
  ),

  group_items: cmd(
    'Wrap items in a new group sized to fit them.',
    { ...where, ids: t.ids, id: t.str('group id'), title: t.str('group title'), description: t.str('what the group is'), padding: t.num('default 48') },
    ['ids', 'title'],
    (store, a) =>
      edit(store, a, (page, name) => {
        const group = build(store, name, page, { type: 'group', id: a.id, title: a.title, description: a.description });
        const list = a.ids.map((id) => find(page, id));
        if (list.every((i) => i.parent === list[0].parent) && list[0].parent) group.parent = list[0].parent;
        page.items.splice(Math.min(...list.map((i) => page.items.indexOf(i))), 0, group);
        group.x = group.y = 0;
        for (const item of list) item.parent = group.id;
        fitGroup(page, group.id, a.padding);
        return { group };
      }),
  ),

  fit_group: cmd('Resize a group to wrap its members.', { ...where, id: t.str('group id'), padding: t.num('default 48') }, ['id'], (store, a) =>
    edit(store, a, (page) => ({ group: fitGroup(page, a.id, a.padding) })),
  ),

  connect: cmd(
    'Draw an arrow. An end is an item id, or "id#element" to anchor to an element inside a frame (an element with id= or data-anchor= in the frame html).',
    { ...where, ...ends, ...arrowProps, id: t.str('arrow id') },
    ['from', 'to'],
    (store, a) =>
      edit(store, a, (page) => {
        const arrow = {};
        for (const key of ARROW_KEYS) if (a[key] !== undefined) arrow[key] = a[key];
        if (arrow.tone && !TONES.includes(arrow.tone)) fail(`tone must be ${TONES.join(', ')}`);
        arrow.id = arrow.id ?? unique(new Set(page.arrows.map((r) => r.id)), `${refItem(arrow.from)}-to-${refItem(arrow.to)}`);
        const { id, ...rest } = arrow;
        page.arrows.push({ id, ...rest });
        return { arrow: page.arrows.at(-1) };
      }),
  ),

  update_arrow: cmd(
    "Change an arrow's ends, label, tone or sides. An empty string clears a field.",
    { ...where, id: t.str('arrow id'), patch: { type: 'object', properties: { ...ends, ...arrowProps } } },
    ['id', 'patch'],
    (store, a) =>
      edit(store, a, (page) => {
        const arrow = page.arrows.find((r) => r.id === a.id);
        if (!arrow) fail(`no arrow ${a.id}`);
        const patch = pick({ ...a.patch }, ARROW_KEYS, 'patch');
        delete patch.id;
        if (patch.tone && !TONES.includes(patch.tone)) fail(`tone must be ${TONES.join(', ')}`);
        Object.assign(arrow, patch);
        for (const key of Object.keys(arrow)) if (arrow[key] === '' || arrow[key] === null) delete arrow[key];
        return { arrow };
      }),
  ),

  remove_arrow: cmd('Remove an arrow.', { ...where, id: t.str('arrow id') }, ['id'], (store, a) =>
    edit(store, a, (page) => {
      const before = page.arrows.length;
      page.arrows = page.arrows.filter((r) => r.id !== a.id);
      if (page.arrows.length === before) fail(`no arrow ${a.id}`);
      return { removed: a.id };
    }),
  ),

  add_page: cmd(
    'Add an empty page (like a Figma page).',
    { project, id: t.str('page id'), title: t.str('shown in the sidebar'), description: t.str('what the page is for') },
    ['id', 'title'],
    (store, a) => {
      const name = store.name(a.project);
      const info = store.project(name);
      if ((info.pages ?? []).some((p) => p.id === a.id)) fail(`page ${a.id} exists`);
      store.savePage(name, a.id, { id: a.id, title: a.title, ...(a.description ? { description: a.description } : {}), items: [], arrows: [] });
      info.pages = [...(info.pages ?? []), { id: a.id, title: a.title }];
      store.saveProject(name, info);
      return { page: a.id };
    },
  ),

  remove_page: cmd('Remove a page from the project. Its file is kept beside the others as <id>.json.removed.', { project, id: t.str('page id') }, ['id'], (store, a) => {
    const name = store.name(a.project);
    const info = store.project(name);
    const data = store.page(name, a.id);
    writeFileSync(`${store.pageFile(name, a.id)}.removed`, JSON.stringify(data));
    info.pages = (info.pages ?? []).filter((p) => p.id !== a.id);
    store.saveProject(name, info);
    return { removed: a.id };
  }),

  move_page: cmd(
    'Change where a page sits in the sidebar: before another page, or last when before is omitted.',
    { project, id: t.str('page id'), before: t.str('the page it should come before') },
    ['id'],
    (store, a) => {
      const name = store.name(a.project);
      const info = store.project(name);
      const pages = info.pages ?? [];
      const page = pages.find((p) => p.id === a.id);
      if (!page) fail(`no page ${a.id}`);
      if (a.before === a.id) fail('a page cannot come before itself');
      const rest = pages.filter((p) => p !== page);
      const at = a.before == null ? rest.length : rest.findIndex((p) => p.id === a.before);
      if (at < 0) fail(`no page ${a.before}`);
      info.pages = [...rest.slice(0, at), page, ...rest.slice(at)];
      store.saveProject(name, info);
      return { pages: info.pages.map((p) => p.id) };
    },
  ),

  list_anchors: cmd(
    'Element ids a frame offers as arrow anchors, with their measured boxes (frame pixels) once the frame has been rendered.',
    { ...where, frame: t.str('frame id') },
    ['frame'],
    (store, a) => {
      const name = store.name(a.project);
      const frame = find(store.page(name, pageId(store, name, a.page)), a.frame);
      const cache = store.inside(name, `.cache/anchors/${frame.id}.json`);
      const boxes = existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf8')).anchors ?? {} : {};
      return anchorsOf(store, name, frame).map((id) => ({ id, box: boxes[id] }));
    },
  ),

  check_design: cmd(
    'Design problems on a page that a person would hit: a tap target under 44x44 on a phone or tablet frame (any control an arrow starts on), text below WCAG contrast (4.5:1, 3:1 when large), and arrows anchored to an element the frame no longer has. Contrast and sizes come from render_frames; frames it has not measured are listed as unmeasured.',
    { ...where },
    [],
    (store, a) => {
      const name = store.name(a.project);
      const page = store.page(name, pageId(store, name, a.page));
      const items = page.items ?? [];
      const byId = new Map(items.map((i) => [i.id, i]));
      const meta = new Map();
      const measured = (id) => {
        if (!meta.has(id)) {
          const cache = store.inside(name, `.cache/anchors/${id}.json`);
          meta.set(id, existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf8')) : null);
        }
        return meta.get(id);
      };
      const problems = [];
      const unmeasured = new Set();
      const touch = (frame) => ['phone', 'tablet'].includes(frame.device);
      for (const ref of new Set((page.arrows ?? []).flatMap((r) => [r.from, r.to]).filter((ref) => ref.includes('#')))) {
        const [id, element] = ref.split('#');
        const frame = byId.get(id);
        if (frame?.type !== 'frame') continue;
        if (!anchorsOf(store, name, frame).includes(element)) {
          problems.push({ item: id, problem: `an arrow is anchored to ${ref}, but ${frame.src} has no element "${element}" any more` });
          continue;
        }
        if (!touch(frame)) continue;
        const box = measured(id)?.anchors?.[element];
        if (!box) unmeasured.add(id);
        else {
          const [w, h] = [Math.round(box[2]), Math.round(box[3])]; // a sub-pixel short of 44 is 44
          if (w < 44 || h < 44) problems.push({ item: id, problem: `${ref} is ${w}x${h}, under 44x44: hard to tap` });
        }
      }
      for (const frame of items.filter((i) => i.type === 'frame')) {
        const cached = measured(frame.id);
        if (cached?.overflow > 1) problems.push({ item: frame.id, problem: `${frame.id} runs ${cached.overflow}px past its right edge at its own width (${frame.w}px)` });
        const already = new Set((cached?.contrast ?? []).map((c) => c.text)); // said once, at its own size
        for (const [size, at] of Object.entries(cached?.sizes ?? {})) {
          if (at.overflow > 1) problems.push({ item: frame.id, problem: `${frame.id} runs ${at.overflow}px past its right edge at ${size} width (${at.w}px)` });
          for (const c of at.contrast.filter((c) => !already.has(c.text))) problems.push({ item: frame.id, problem: `"${c.text}" at ${size} width is ${c.ratio}:1 (${c.fg} on ${c.bg}), needs ${c.need}:1` });
        }
        const found = cached?.contrast;
        if (!found) unmeasured.add(frame.id);
        const said = new Set(); // the same text in the same colours, said once per frame
        for (const c of found ?? []) {
          const problem = `"${c.text}" is ${c.ratio}:1 (${c.fg} on ${c.bg}), needs ${c.need}:1`;
          if (!said.has(problem)) said.add(problem) && problems.push({ item: frame.id, problem });
        }
      }
      return { problems, ...(unmeasured.size ? { unmeasured: [...unmeasured], hint: 'run render_frames to measure them' } : {}) };
    },
  ),

  check_arrows: cmd(
    'Arrows the studio would draw badly on a page: two that cross or run along each other, or one that cuts through a frame, table or node. Run it after laying out a flow and fix what it lists: move items first, else set fromSide/toSide. Run render_frames first if it lists unmeasured frames.',
    { ...where },
    [],
    (store, a) => {
      const name = store.name(a.project);
      const page = store.page(name, pageId(store, name, a.page));
      const boxes = new Map();
      const unmeasured = new Set();
      const boxOf = (id, element) => {
        if (!boxes.has(id)) {
          const cache = store.inside(name, `.cache/anchors/${id}.json`);
          boxes.set(id, existsSync(cache) ? JSON.parse(readFileSync(cache, 'utf8')).anchors ?? {} : null);
        }
        if (!boxes.get(id)) unmeasured.add(id);
        return boxes.get(id)?.[element] ?? null;
      };
      const problems = checkArrows(page.items ?? [], page.arrows ?? [], boxOf);
      return { problems, ...(unmeasured.size ? { unmeasured: [...unmeasured] } : {}) };
    },
  ),

  list_tokens: cmd("Design tokens: every --name: value in the project's tokens css.", { project }, [], (store, a) => {
    const name = store.name(a.project);
    return tokens(readFileSync(tokenFile(store, name), 'utf8'));
  }),

  set_token: cmd(
    "Change one design token's value in the tokens css. Open frames reload by themselves; run render_frames to refresh previews.",
    { project, name: t.str('--token-name'), value: t.str('css value'), create: t.bool('add the token when it does not exist') },
    ['name', 'value'],
    (store, a) => {
      const file = tokenFile(store, store.name(a.project));
      let css = readFileSync(file, 'utf8');
      const token = a.name.startsWith('--') ? a.name : `--${a.name}`;
      if (!/^--[\w-]+$/.test(token)) fail(`bad token name ${token}`);
      if (/[;{}]/.test(a.value)) fail('value may not contain ; { or }');
      const pattern = new RegExp(`(${token}\\s*:\\s*)([^;]+)(;)`);
      if (pattern.test(css)) css = css.replace(pattern, (_m, head, _old, tail) => `${head}${a.value}${tail}`);
      else if (a.create) css = css.replace(/:root\s*{/, (open) => `${open}\n  ${token}: ${a.value};`);
      else fail(`no token ${token}; pass create: true to add it`);
      writeFileSync(file, css);
      return { name: token, value: a.value };
    },
  ),

  set_cell: cmd(
    'Set one cell of a table (the plan is one): the cheapest way to record progress. An empty value clears it.',
    { ...where, id: t.str('table item id'), row: t.str('row id'), column: t.str('column id'), value: t.str('the cell text, e.g. "built"') },
    ['id', 'row', 'column', 'value'],
    (store, a) => edit(store, a, (page) => tableEdit(page, a.id, (table) => tables.setCell(table, a.row, a.column, a.value), { row: a.row, column: a.column, value: a.value })),
  ),

  add_row: cmd(
    'Add a row to a table, at the end or before another row.',
    { ...where, id: t.str('table item id'), row: { type: 'object', description: '{id, title, link?: "page/item", cells?: {columnId: text}}' }, before: t.str('row id to insert before') },
    ['id', 'row'],
    (store, a) =>
      edit(store, a, (page, name) =>
        tableEdit(page, a.id, (table) => {
          tables.addRow(table, a.row, a.before);
          checkLinks(store, name, table);
        }, { row: a.row.id }),
      ),
  ),

  remove_row: cmd('Remove a row from a table.', { ...where, id: t.str('table item id'), row: t.str('row id') }, ['id', 'row'], (store, a) =>
    edit(store, a, (page) => tableEdit(page, a.id, (table) => tables.removeRow(table, a.row), { removed: a.row })),
  ),

  add_column: cmd(
    'Add a column to a table, at the end or before another column. The table grows wider.',
    { ...where, id: t.str('table item id'), column: { type: 'object', description: '{id, title, note?}' }, before: t.str('column id to insert before') },
    ['id', 'column'],
    (store, a) => edit(store, a, (page) => tableEdit(page, a.id, (table) => tables.addColumn(table, a.column, a.before), { column: a.column.id })),
  ),

  remove_column: cmd('Remove a column, and its cells, from a table.', { ...where, id: t.str('table item id'), column: t.str('column id') }, ['id', 'column'], (store, a) =>
    edit(store, a, (page) => tableEdit(page, a.id, (table) => tables.removeColumn(table, a.column), { removed: a.column })),
  ),

  render_frames: cmd(
    'Render preview images and measure anchors (and the height of autoHeight frames) with the local Chrome or Edge. Only stale frames unless force is true.',
    { ...where, ids: t.ids, force: t.bool('re-render even when up to date') },
    [],
    async (store, a) => {
      const { render } = await import('./browser.mjs');
      return render(store, a);
    },
  ),

  export_item: cmd(
    'Export a frame, a group (with its frames and arrows) or any item as png, webp, pdf or svg, saved under <project>/exports/. svg embeds the png: pdf is the format that keeps text sharp.',
    {
      ...where,
      id: t.str('item id'),
      format: t.one(['png', 'webp', 'pdf', 'svg'], 'default png'),
      scale: t.num('1 to 3, default 2; lowered when the item is too large for the browser'),
      background: t.one(['paper', 'transparent'], 'default paper; transparent for png and webp'),
      theme: t.one(['light', 'dark'], 'for groups; default light'),
      lines: t.one(['straight', 'curved', 'elbow'], 'arrow style for groups; default elbow'),
      base: t.str('studio url to draw groups with; by default a private one is started'),
    },
    ['id'],
    async (store, a) => {
      const { exportItem } = await import('./export.mjs');
      const name = store.name(a.project);
      return exportItem(store, { ...a, project: name, page: pageId(store, name, a.page) });
    },
  ),

  link: cmd('The URL that opens a page, or focuses one item, in the studio. Hand it to the person reviewing.', { ...where, id: t.str('item id to focus') }, [], (store, a) => {
    const name = store.name(a.project);
    const base = process.env.FRAMERY_URL ?? studioUrl(store);
    return `${base}/#/${name}/${pageId(store, name, a.page)}${a.id ? '/' + a.id : ''}`;
  }),

  batch: cmd(
    'Run several tools as one step: in order, all or nothing (if one call fails, the ones before it are undone and nothing is saved), recorded as one history entry. project and page given here are the default for every call.',
    { ...where, calls: { type: 'array', items: { type: 'object' }, description: '[{tool, args}], e.g. [{"tool":"update_item","args":{"id":"a","patch":{"title":"Home"}}}]' } },
    ['calls'],
    async (store, a) => {
      if (!Array.isArray(a.calls) || !a.calls.length) fail('calls: a list of {tool, args}');
      const name = store.name(a.project);
      const undo = snapshot(store, name);
      const results = [];
      for (const [i, call] of a.calls.entries()) {
        try {
          if (call?.tool === 'batch' || historyCommands[call?.tool]) fail(`${call.tool} cannot run inside a batch`);
          const props = commands[call?.tool]?.input.properties ?? {};
          const args = { ...('project' in props ? { project: name } : {}), ...(a.page && 'page' in props ? { page: a.page } : {}), ...call?.args };
          results.push(await checked(call?.tool, args).run(store, args));
        } catch (error) {
          undo();
          fail(`call ${i + 1} (${call?.tool}): ${error.message}. Nothing was changed.`);
        }
      }
      return results;
    },
  ),

  ...componentCommands,
  ...historyCommands,
};

function checked(name, args) {
  const command = commands[name];
  if (!command) fail(`unknown command ${name}; have: ${Object.keys(commands).join(', ')}`);
  for (const key of command.input.required) if (args[key] === undefined) fail(`${name}: "${key}" is required`);
  for (const key of Object.keys(args)) if (!(key in command.input.properties)) fail(`${name}: unknown argument "${key}"`);
  return command;
}

export async function run(store, name, args = {}) {
  const command = checked(name, args);
  // Every command is followed by a look at what it changed, so the undo trail covers the tools without
  // each tool knowing about it. The history commands keep their own books.
  const tracked = historyCommands[name] ? null : projectOf(store, args);
  if (tracked) begin(store, tracked);
  try {
    return await command.run(store, args);
  } finally {
    if (tracked) {
      try {
        record(store, tracked, name);
      } catch (error) {
        console.error(`history: ${error.message}`);
      }
    }
  }
}

function projectOf(store, args) {
  try {
    return store.name(args.project);
  } catch {
    return null;
  }
}
