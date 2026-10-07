// The checks that fail if framery's core breaks: commands, validation, layout, MCP framing and the
// package's own init. Run: node --test framery/test

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../src/commands.mjs';
import { findBrowser } from '../src/browser.mjs';
import { doctor } from '../src/doctor.mjs';
import { fit } from '../src/export.mjs';
import { checkArrows } from '../ui/canvas/check.js';
import { resolve } from '../ui/canvas/geometry.js';
import { gapsOf } from '../ui/canvas/renderers/group.js';
import { labelAt } from '../ui/canvas/routes.js';
import { layoutFlow } from '../src/layout.mjs';
import { init } from '../src/init.mjs';
import { Store } from '../src/store.mjs';
import { along } from '../ui/panels/shortcuts.js';
import { serve } from '../src/server.mjs';
import { createServer } from 'node:net';

const PKG = fileURLToPath(new URL('..', import.meta.url));

// A scratch project with two real frames, so tests never touch the shipped data.
function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'framery-test-'));
  init({ dir: root });
  const store = new Store(join(root, 'framery'));
  const [project] = store.projects();
  for (const name of ['a', 'b']) writeFileSync(join(store.dir(project), `${name}.html`), `<body><button id="go-${name}">Go</button></body>`);
  return { root, store, project, call: (tool, args) => run(store, tool, { project, page: 'flows', ...args }) };
}

test('frames get device sizes, positions and stable ids', async () => {
  const { call } = scratch();
  const a = (await call('add_item', { type: 'frame', title: 'Screen A', src: 'a.html', device: 'phone' })).item;
  const b = (await call('add_item', { type: 'frame', title: 'Screen B', src: 'b.html', device: 'desktop' })).item;
  assert.equal(a.id, 'screen-a');
  assert.deepEqual([a.w, a.h, b.w, b.h], [390, 844, 1280, 800]);
  assert.ok(b.x >= a.x + a.w, 'a new frame lands right of its neighbour');
});

test('a frame must say its device; document is a fixed width with auto height', async () => {
  const { call } = scratch();
  await assert.rejects(call('add_item', { type: 'frame', src: 'a.html' }), /needs device/);
  const doc = (await call('add_item', { type: 'frame', id: 'spec', src: 'a.html', device: 'document' })).item;
  assert.deepEqual([doc.w, doc.h, doc.autoHeight], [960, 1200, true]);
});

test('export caps the scale by side and by area', () => {
  assert.ok(Math.abs(fit(3, 4678, 3528) - 1.39) < 0.01);
  assert.equal(fit(3, 390, 844), 3);
  assert.equal(fit(3, 20000, 100), 0.8);
});

test('arrows: crossings and cuts through items are reported; a shared lane is spread; a bottom control leaves sideways', () => {
  const frame = (id, x, y) => ({ id, type: 'frame', x, y, w: 390, h: 844 });
  const none = () => null;
  // an X: a -> d and c -> b swap rows in the gap between the columns
  const x = [frame('a', 0, 0), frame('b', 600, 0), frame('c', 0, 1000), frame('d', 600, 1000)];
  const crossed = checkArrows(x, [{ id: 'ad', from: 'a', to: 'd' }, { id: 'cb', from: 'c', to: 'b' }], none);
  assert.deepEqual(crossed.map((p) => p.arrows), [['ad', 'cb']]);
  assert.deepEqual(checkArrows(x, [{ id: 'ab', from: 'a', to: 'b' }, { id: 'cd', from: 'c', to: 'd' }], none), []);
  // a node in the way, forced through by sides that leave no other route
  const through = checkArrows([...x, { id: 'n', type: 'node', x: 450, y: 380, w: 100, h: 80 }], [{ id: 'ab', from: 'a', to: 'b', fromSide: 'right', toSide: 'left' }], none);
  assert.equal(through[0]?.through, 'n');

  const lane = [frame('a', 0, 0), frame('b', 1000, 400), frame('c', 0, 1200)];
  const [ab, cb] = resolve([{ id: 'ab', from: 'a', to: 'b' }, { id: 'cb', from: 'c', to: 'b' }], lane, none);
  assert.ok(ab.via.x != null && cb.via.x != null && Math.abs(ab.via.x - cb.via.x) >= 8, 'two runs in one lane sit apart');

  const stacked = [frame('top', 0, -1200), frame('f', 0, 0)];
  const [up] = resolve([{ id: 'up', from: 'f#retry', to: 'top' }], stacked, (id, el) => (id === 'f' && el === 'retry' ? [16, 780, 358, 48] : null));
  assert.equal(up.n0[1], 0, 'leaves from the side, not up through its own screen');

  // a diamond: every end on one of its four points, a second arrow on a taken side moves to a free point
  const branch = [{ id: 'q', type: 'node', shape: 'diamond', x: 0, y: 0, w: 200, h: 120 }, frame('yes', 400, -362), frame('no', 400, 400)];
  const [yes, no] = resolve([{ id: 'y', from: 'q', to: 'yes' }, { id: 'n', from: 'q', to: 'no' }], branch, none);
  assert.deepEqual(yes.p0, [200, 60]);
  assert.deepEqual(no.p0, [100, 120], 'the second branch leaves from the bottom point');
  assert.deepEqual(checkArrows(stacked, [{ id: 'up', from: 'f#retry', to: 'top' }], (id, el) => (id === 'f' && el === 'retry' ? [16, 780, 358, 48] : null)), []);
});

test('stepping along a flow follows arrows, the happy path first at a branch', () => {
  const at = (id, x, y) => ({ id, type: 'frame', x, y, w: 10, h: 10 });
  const page = {
    items: [at('a', 0, 0), at('q', 100, 0), at('yes', 200, 0), at('no', 200, 100), at('lone', 0, 500)],
    arrows: [
      { id: 'aq', from: 'a#go', to: 'q' },
      { id: 'qn', from: 'q', to: 'no', tone: 'negative' },
      { id: 'qy', from: 'q', to: 'yes', tone: 'positive' },
    ],
  };
  assert.equal(along(page, null, 1), 'a', 'nothing selected: the start of the flow');
  assert.equal(along(page, { kind: 'item', id: 'a' }, 1), 'q', 'an anchored arrow counts');
  assert.equal(along(page, { kind: 'item', id: 'q' }, 1), 'yes');
  assert.equal(along(page, { kind: 'item', id: 'no' }, -1), 'q');
  assert.equal(along(page, { kind: 'arrow', id: 'qn' }, 1), 'no');
  assert.equal(along(page, { kind: 'item', id: 'yes' }, 1), null, 'the end of the flow');
  assert.equal(along(page, { kind: 'item', id: 'lone' }, -1), null);
});

test('a group caption has the room up to the item above it, or to the top of the group around it', () => {
  const gaps = gapsOf([
    { id: 'outer', type: 'group', x: 0, y: 0, w: 1000, h: 1000 },
    { id: 'top', type: 'group', x: 48, y: 48, w: 900, h: 400 },
    { id: 'low', type: 'group', x: 48, y: 500, w: 900, h: 400 },
    { id: 'aside', type: 'frame', x: 2000, y: 0, w: 390, h: 844 },
  ]);
  assert.deepEqual([gaps.get('outer'), gaps.get('top'), gaps.get('low')], [Infinity, 48, 52]);
});

test('layout_flow: the longest path in a row, the happier branch on a tie, states under their screen', () => {
  const at = (id, w = 390, h = 844) => ({ id, type: 'frame', x: Math.random() * 3000, y: Math.random() * 3000, w, h });
  const page = {
    id: 'p',
    items: [at('home'), at('list'), at('detail'), at('add'), at('q', 200, 120), at('ok'), at('error'), at('note')],
    arrows: [
      { id: '1', from: 'home#add', to: 'add', tone: 'positive' }, // a dead end, positive or not
      { id: '2', from: 'home#all', to: 'list' },
      { id: '3', from: 'list', to: 'detail' },
      { id: '4', from: 'detail', to: 'q' },
      { id: '5', from: 'q', to: 'error', tone: 'negative' },
      { id: '6', from: 'q', to: 'ok', tone: 'positive' },
      { id: '7', from: 'error#retry', to: 'detail' },
    ],
  };
  layoutFlow(page, page.items.map((i) => i.id), { x: 0, y: 0 });
  const pos = Object.fromEntries(page.items.map((i) => [i.id, [Math.round(i.x), Math.round(i.y)]]));
  const row = ['home', 'list', 'detail', 'q', 'ok'];
  assert.deepEqual(row.map((id) => pos[id][0]), [...row.map((id) => pos[id][0])].sort((a, b) => a - b), 'the main path reads left to right');
  assert.ok(row.every((id) => pos[id][1] < 844), 'and sits in the first row');
  assert.equal(pos.error[0], pos.detail[0], 'a failure state goes under the screen it returns to');
  assert.equal(pos.add[0], pos.home[0], 'a dead end goes under the screen that leads to it');
  assert.ok(pos.error[1] > 844 && pos.add[1] > 844);
  assert.ok(pos.note[0] > pos.ok[0], 'an unconnected item goes after the row');
});

test('a label slides along its line to a clear spot', () => {
  const line = [[0, 0], [0, 400]];
  assert.deepEqual(labelAt(line, [0, 200], 100, []), [0, 200], 'nothing in the way: the middle');
  const moved = labelAt(line, [0, 200], 100, [{ x: -60, y: 150, w: 120, h: 120 }]);
  assert.equal(moved[0], 0);
  assert.ok(moved[1] + 10 <= 150 || moved[1] - 10 >= 270, 'off the box, on the line');
});

test('batch runs calls in order as one history entry, and a failing call leaves nothing changed', async () => {
  const { call, store, project } = scratch();
  const files = () => readFileSync(join(store.dir(project), 'pages', 'flows.json'), 'utf8');
  const out = await call('batch', {
    calls: [
      { tool: 'add_item', args: { type: 'frame', id: 'a', src: 'a.html', device: 'phone' } },
      { tool: 'add_item', args: { type: 'frame', id: 'b', src: 'b.html', device: 'phone' } },
      { tool: 'connect', args: { from: 'a', to: 'b' } },
    ],
  });
  assert.equal(out.length, 3);
  const trail = await run(store, 'history', { project });
  assert.deepEqual(trail[0].tools, ['batch'], 'one entry for the three calls');
  const before = files();
  await assert.rejects(
    call('batch', { calls: [{ tool: 'update_item', args: { id: 'a', patch: { title: 'Renamed' } } }, { tool: 'add_page', args: { id: 'p2', title: 'P2' } }, { tool: 'connect', args: { from: 'a', to: 'ghost' } }] }),
    /call 3 \(connect\).*Nothing was changed/,
  );
  assert.equal(files(), before, 'the first call was undone');
  assert.ok(!existsSync(join(store.dir(project), 'pages', 'p2.json')), 'a file a call made is gone');
  assert.ok(!store.project(project).pages.some((p) => p.id === 'p2'));
  await assert.rejects(call('batch', { calls: [{ tool: 'undo', args: {} }] }), /cannot run inside a batch/);
});

test('rename_item carries arrows, children, table links and the preview to the new id', async () => {
  const { call, store, project } = scratch();
  await call('add_item', { type: 'frame', id: 'a', src: 'a.html', device: 'phone', x: 0, y: 0 });
  await call('add_item', { type: 'frame', id: 'b', src: 'b.html', device: 'phone', x: 600, y: 0 });
  await call('connect', { from: 'a#go-a', to: 'b' });
  await call('group_items', { id: 'flow', ids: ['a', 'b'], title: 'Flow' });
  await run(store, 'add_page', { project, id: 'plan', title: 'Plan' });
  await call('add_item', { page: 'plan', type: 'table', id: 't', title: 'T', columns: [{ id: 'c', title: 'C' }], rows: [{ id: 'r', title: 'R', link: 'flows/a', cells: {} }] });
  mkdirSync(join(store.dir(project), '.cache', 'frames'), { recursive: true });
  writeFileSync(join(store.dir(project), '.cache', 'frames', 'a.webp'), 'x');
  await assert.rejects(call('rename_item', { id: 'a', to: 'b' }), /taken/);
  const out = await call('rename_item', { id: 'a', to: 'start' });
  assert.deepEqual([out.arrows, out.links], [1, 1]);
  const page = store.page(project, 'flows');
  assert.equal(page.arrows[0].from, 'start#go-a', 'the anchor stays');
  assert.equal(page.items.find((i) => i.id === 'start').parent, 'flow');
  assert.equal(store.page(project, 'plan').items[0].rows[0].link, 'flows/start');
  assert.ok(existsSync(join(store.dir(project), '.cache', 'frames', 'start.webp')));
});

test('move_page reorders the sidebar and refuses pages that do not exist', async () => {
  const { store, project } = scratch();
  const call = (tool, args) => run(store, tool, { project, ...args });
  await call('add_page', { id: 'two', title: 'Two' });
  await call('add_page', { id: 'three', title: 'Three' });
  assert.deepEqual((await call('move_page', { id: 'three', before: 'flows' })).pages, ['three', 'flows', 'two']);
  assert.deepEqual((await call('move_page', { id: 'three' })).pages, ['flows', 'two', 'three']);
  await assert.rejects(call('move_page', { id: 'two', before: 'nope' }), /no page nope/);
  await assert.rejects(call('move_page', { id: 'nope' }), /no page nope/);
});

test('move_to_page carries a group, its members and their arrows; refuses crossing arrows and clashing ids', async () => {
  const { call, store, project } = scratch();
  await run(store, 'add_page', { project, id: 'other', title: 'Other' });
  await call('add_item', { type: 'frame', id: 'a', src: 'a.html', device: 'phone', x: 0, y: 0 });
  await call('add_item', { type: 'frame', id: 'b', src: 'b.html', device: 'phone', x: 600, y: 0 });
  await call('add_item', { type: 'node', id: 'c', x: 0, y: 1200 });
  await call('connect', { from: 'a', to: 'b' });
  const { group } = await call('group_items', { ids: ['a', 'b'], title: 'Flow' });
  await call('connect', { from: 'b', to: 'c' });
  const files = () => JSON.stringify([store.page(project, 'flows'), store.page(project, 'other')]);
  const before = files();
  await assert.rejects(call('move_to_page', { ids: [group.id], to: 'other' }), /arrows would cross pages/);
  assert.equal(files(), before, 'a refused move changes nothing');
  await call('remove_arrow', { id: (await call('get_page', {})).arrows.find((r) => r.to === 'c').id });
  const done = await call('move_to_page', { ids: [group.id], to: 'other', dx: 10 });
  assert.deepEqual(done.moved.sort(), ['a', 'b', group.id].sort());
  const [source, target] = [store.page(project, 'flows'), store.page(project, 'other')];
  assert.deepEqual(source.items.map((i) => i.id), ['c']);
  assert.equal(source.arrows.length, 0);
  assert.equal(target.arrows.length, 1);
  assert.equal(target.items.find((i) => i.id === 'a').x, 10);
  await call('add_item', { type: 'node', id: 'a', x: 0, y: 0 });
  await assert.rejects(call('move_to_page', { ids: ['a'], to: 'other' }), /ids already on other: a/);
});

test('arrows anchor to elements that exist, and only those', async () => {
  const { call } = scratch();
  await call('add_item', { type: 'frame', id: 'a', src: 'a.html', device: 'phone' });
  await call('add_item', { type: 'frame', id: 'b', src: 'b.html', device: 'phone' });
  const ok = await call('connect', { from: 'a#go-a', to: 'b', label: 'tap Go', tone: 'positive' });
  assert.equal(ok.arrow.from, 'a#go-a');
  await assert.rejects(call('connect', { from: 'a#nope', to: 'b' }), /no element "nope"/);
  await assert.rejects(call('connect', { from: 'a', to: 'ghost' }), /no item "ghost"/);
  await assert.rejects(call('connect', { from: 'a', to: 'b', tone: 'blue' }), /tone must be/);
});

test('a group wraps its members, moves them with it, and removing an item drops its arrows', async () => {
  const { call } = scratch();
  await call('add_item', { type: 'frame', id: 'a', src: 'a.html', device: 'phone', x: 0, y: 0 });
  await call('add_item', { type: 'frame', id: 'b', src: 'b.html', device: 'phone', x: 600, y: 0 });
  await call('connect', { from: 'a', to: 'b' });
  const { group } = await call('group_items', { ids: ['a', 'b'], title: 'Flow' });
  assert.ok(group.x < 0 && group.x + group.w > 600 + 390, 'group covers both frames');
  await call('move_items', { ids: [group.id], dx: 100, dy: 50 });
  const page = await call('get_page', {});
  assert.equal(page.items.find((i) => i.id === 'a').x, 100);
  const removed = await call('remove_item', { id: 'b' });
  assert.equal(removed.arrowsRemoved, 1);
});

test('arrange lays items in a row with an even gap; outline reads in arrow order', async () => {
  const { call } = scratch();
  await call('add_item', { type: 'frame', id: 'a', src: 'a.html', device: 'phone', x: 900, y: 0, description: 'First.' });
  await call('add_item', { type: 'frame', id: 'b', src: 'b.html', device: 'phone', x: 0, y: 0, description: 'Second.' });
  await call('connect', { from: 'a', to: 'b', label: 'next' });
  const text = await call('outline', {});
  assert.ok(text.indexOf('[a]') < text.indexOf('[b]'), 'arrows decide the order, not x');
  await call('arrange', { ids: ['b', 'a'], x: 0, y: 0, gap: 100 });
  const page = await call('get_page', {});
  assert.equal(page.items.find((i) => i.id === 'a').x, 390 + 100);
});

test('tokens: read, change, and refuse a value that could break the css', async () => {
  const { store, project } = scratch();
  const call = (tool, args) => run(store, tool, { project, ...args });
  await call('set_token', { name: '--accent', value: '#123456' });
  const tokens = await call('list_tokens', {});
  assert.equal(tokens.find((t) => t.name === '--accent').value, '#123456');
  await assert.rejects(call('set_token', { name: '--accent', value: 'red; } body { display:none' }), /may not contain/);
  await assert.rejects(call('set_token', { name: '--nope', value: '1' }), /no token/);
});

test('a table is sized by its content, edited one cell at a time, and read as a grid', async () => {
  const { call } = scratch();
  await call('add_item', { type: 'frame', id: 'a', src: 'a.html', device: 'phone' });
  const table = (
    await call('add_item', {
      type: 'table',
      id: 'plan',
      title: 'Plan',
      columns: [{ id: 'p1', title: 'Phase 1' }, { id: 'p2', title: 'Phase 2' }],
      rows: [{ id: 'home', title: 'Home', link: 'flows/a', cells: { p1: 'drawn' } }],
      marks: { drawn: 'accent', built: 'positive' },
    })
  ).item;
  const before = table.h;
  const set = await call('set_cell', { id: 'plan', row: 'home', column: 'p1', value: 'built' });
  assert.equal(set.table.rows, 1);
  const added = await call('add_row', { id: 'plan', row: { id: 'edit', title: 'Edit' } });
  assert.ok(added.table.h > before, 'the table grows with its rows');
  const text = await call('outline', {});
  assert.match(text, /\| Home \| built \| - \| {2}-> flows\/a/);
  await assert.rejects(call('set_cell', { id: 'plan', row: 'home', column: 'nope', value: 'x' }), /no column/);
  await assert.rejects(call('add_row', { id: 'plan', row: { id: 'x', title: 'X', link: 'flows/ghost' } }), /names no item/);
  await assert.rejects(call('update_item', { id: 'plan', patch: { marks: { built: 'purple' } } }), /style must be/);
  await assert.rejects(call('set_cell', { id: 'a', row: 'home', column: 'p1', value: 'x' }), /not a table/);
  await call('remove_column', { id: 'plan', column: 'p2' });
  assert.equal((await call('get_page', {})).items.find((i) => i.id === 'plan').columns.length, 1);
});

test('components: promote repeated markup, change it once, every frame follows; detach gives plain markup back', async () => {
  const { store, project } = scratch();
  const dir = store.dir(project);
  const btn = (cls, text, extra = '') => `<button class="btn ${cls}" type="button"${extra}>${text}</button>`;
  writeFileSync(join(dir, 'a.html'), `<body>${btn('btn--primary', 'Save', ' data-anchor="save"')}${btn('btn--danger btn--block', 'Delete')}<p class="odd">x</p></body>`);
  writeFileSync(join(dir, 'b.html'), `<body>${btn('btn--primary', 'Next')}<button class="btn" type="button" aria-label="odd">?</button></body>`);
  const call = (tool, args) => run(store, tool, { project, ...args });

  const found = await call('find_candidates', { min: 3 });
  assert.ok(found.some((c) => c.key === 'button.btn' && c.count === 4), 'the repeated button is a candidate');

  const made = await call('promote_component', { id: 'button', tag: 'button', block: 'btn', variants: ['primary', 'danger'], flags: ['block'] });
  assert.equal(made.converted, 3, 'three copies become references');
  assert.equal(made.kept.length, 1, 'the copy with an extra attribute is left alone and reported');
  const a = readFileSync(join(dir, 'a.html'), 'utf8');
  assert.match(a, /<!-- fr:component button variant="primary" anchor="save" label="Save" -->/);
  assert.match(a, /<button data-fr-component="button" data-anchor="save" class="btn btn--primary" type="button">Save<\/button>/);

  // the anchor still validates: a frame's html is plain html with the id in it
  assert.deepEqual((await call('component_usage', { id: 'button' })).frames.length, 2);

  // one edit to the definition rewrites every instance
  await call('update_component', { id: 'button', html: '<button class="btn {{variant}} {{block}} {{extra}}" type="button">» {{label}}</button>' });
  assert.match(readFileSync(join(dir, 'a.html'), 'utf8'), />» Save<\/button>/);
  assert.match(readFileSync(join(dir, 'b.html'), 'utf8'), />» Next<\/button>/);
  assert.match(readFileSync(join(dir, 'b.html'), 'utf8'), /aria-label="odd">\?<\/button>/, 'plain markup is untouched');

  const renamed = await call('rename_component', { id: 'button', to: 'action', title: 'Action' });
  assert.equal(renamed.renamed, 3);
  assert.match(readFileSync(join(dir, 'a.html'), 'utf8'), /<!-- fr:component action variant="primary"/);
  assert.match(readFileSync(join(dir, 'a.html'), 'utf8'), /data-fr-component="action"/);
  await call('rename_component', { id: 'action', to: 'button', title: 'Button' });

  await assert.rejects(call('use_component', { file: 'b.html', component: 'button', props: { colour: 'red' }, before: '<button class="btn" type="button" aria-label="odd">' }), /no prop "colour"/);
  const detached = await call('detach_component', { file: 'a.html' });
  assert.equal(detached.detached, 2);
  assert.doesNotMatch(readFileSync(join(dir, 'a.html'), 'utf8'), /fr:component/);
  const removed = await call('remove_component', { id: 'button' });
  assert.equal(removed.detached, 1);
  assert.deepEqual((await call('list_components', {})), []);
});

test('export: a frame as png, pdf and svg, a group through the studio, and a bad format is refused', async (t) => {
  if (!findBrowser()) return t.skip('no Chrome or Edge here');
  const { store, project } = scratch();
  writeFileSync(join(store.dir(project), 'a.html'), '<body style="margin:0;background:#f4f1ea"><h1 id="t">Hello</h1></body>');
  const call = (tool, args) => run(store, tool, { project, page: 'flows', ...args });
  await call('add_item', { type: 'frame', id: 'a', src: 'a.html', x: 0, y: 0, w: 200, h: 120, device: 'custom', title: 'A' });
  await call('add_item', { type: 'frame', id: 'b', src: 'b.html', x: 400, y: 0, w: 200, h: 120, device: 'custom', title: 'B' });
  await call('connect', { from: 'a', to: 'b', label: 'next' });
  await call('group_items', { id: 'flow', ids: ['a', 'b'], title: 'Flow' });

  const png = await call('export_item', { id: 'a', format: 'png', scale: 2 });
  assert.deepEqual([png.width, png.height], [400, 240]);
  assert.equal(readFileSync(join(store.dir(project), png.file)).subarray(1, 4).toString(), 'PNG');
  const pdf = await call('export_item', { id: 'a', format: 'pdf' });
  assert.equal(readFileSync(join(store.dir(project), pdf.file)).subarray(0, 4).toString(), '%PDF');
  const svg = await call('export_item', { id: 'a', format: 'svg', scale: 1 });
  assert.match(readFileSync(join(store.dir(project), svg.file), 'utf8'), /^<svg[^>]*width="200"[^>]*><image/);
  const group = await call('export_item', { id: 'flow', format: 'png', scale: 1 });
  assert.ok(group.width > 600 && group.height > 120, 'the group export covers both frames and its margin');
  await assert.rejects(call('export_item', { id: 'a', format: 'gif' }), /format must be one of/);
});

test('check_design: small tap targets, low contrast text, and anchors that are gone', async (t) => {
  if (!findBrowser()) return t.skip('no Chrome or Edge here');
  const { call, store, project } = scratch();
  const file = join(store.dir(project), 'a.html');
  writeFileSync(file, '<body style="margin:0;background:#fff"><p style="color:#999">Faint words</p><p style="color:#222">Clear words</p><button id="go" style="width:20px;height:20px"></button><button id="ok" style="width:120px;height:48px">OK</button></body>');
  await call('add_item', { type: 'frame', id: 'a', src: 'a.html', device: 'phone', x: 0, y: 0 });
  await call('add_item', { type: 'frame', id: 'b', src: 'b.html', device: 'phone', x: 600, y: 0 });
  await call('connect', { from: 'a#go', to: 'b' });
  await call('connect', { from: 'a#ok', to: 'b' });
  assert.deepEqual((await call('check_design', {})).unmeasured, ['a', 'b'], 'nothing rendered yet');
  await call('render_frames', {});
  const found = (await call('check_design', {})).problems.map((p) => p.problem);
  assert.equal(found.length, 2, found.join('; '));
  assert.match(found[0], /a#go is 20x20, under 44x44/);
  assert.match(found[1], /"Faint words" is 2\.85:1 \(#999999 on #ffffff\), needs 4\.5:1/);
  writeFileSync(file, readFileSync(file, 'utf8').replace('id="go" ', ''));
  assert.match((await call('check_design', {})).problems[0].problem, /no element "go" any more/);
});

test('paths cannot leave the project', async () => {
  const { call } = scratch();
  await assert.rejects(call('add_item', { type: 'frame', src: '../../etc/passwd' }), /leaves the project|no file/);
});

test('the studio takes the next free port unless one was asked for, and link follows it', async () => {
  const { store, project } = scratch();
  const listening = (server) => new Promise((ok, no) => server.once('listening', ok).once('error', no));
  const busy = createServer().listen(0, '127.0.0.1');
  await listening(busy);
  const taken = busy.address().port;
  const studio = serve({ root: store.root, port: taken, autoRender: false, quiet: true });
  await new Promise((ok) => studio.once('listening', ok)); // the busy port's error is the server's own to handle
  assert.equal(studio.address().port, taken + 1);
  assert.match(await run(store, 'link', { project, page: 'flows' }), new RegExp(`:${taken + 1}/#/`));
  studio.close();
  busy.close();
});

test('MCP: initialize, list tools, call one, report an error as isError', async () => {
  const { root } = scratch();
  const child = spawn(process.execPath, [join(PKG, 'bin/framery.mjs'), 'mcp', '--data', join(root, 'framery')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) replies.set(JSON.parse(line).id, JSON.parse(line));
  });
  const ask = async (id, method, params) => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    for (let i = 0; i < 100 && !replies.has(id); i++) await new Promise((r) => setTimeout(r, 30));
    return replies.get(id).result;
  };
  try {
    assert.equal((await ask(1, 'initialize', {})).serverInfo.name, 'framery');
    const { tools } = await ask(2, 'tools/list');
    assert.ok(tools.some((t) => t.name === 'outline') && tools.every((t) => t.inputSchema.type === 'object'));
    const good = await ask(3, 'tools/call', { name: 'get_project', arguments: {} });
    assert.ok(!good.isError && JSON.parse(good.content[0].text).pages.length === 1);
    const bad = await ask(4, 'tools/call', { name: 'outline', arguments: { page: 'missing' } });
    assert.equal(bad.isError, true);
  } finally {
    child.kill();
  }
});

test('init wires skills for both agents, an MCP entry and an empty project; twice is safe', () => {
  const root = mkdtempSync(join(tmpdir(), 'framery-init-'));
  writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
  init({ dir: root });
  init({ dir: root });
  for (const dir of ['.claude/skills/framery', '.omp/skills/framery']) assert.ok(existsSync(join(root, dir, 'SKILL.md')), dir);
  const mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
  assert.ok(mcp.mcpServers.other && mcp.mcpServers.framery, 'existing servers are kept');
  assert.equal(new Store(join(root, 'framery')).projects().length, 1);
});

test('history: one prompt is one entry, restore goes back and can itself be undone, outside edits are caught', async () => {
  const { call, store, project } = scratch();
  const read = () => readFileSync(join(store.dir(project), 'a.html'), 'utf8') + JSON.stringify(store.page(project, 'flows'));
  const origin = read();
  await call('add_item', { type: 'frame', id: 'a', src: 'a.html', device: 'phone' });
  await call('move_items', { ids: ['a'], dx: 40 });
  await call('update_item', { id: 'a', patch: { description: 'x' } });
  const afterTools = read();
  let trail = await run(store, 'history', { project });
  assert.equal(trail.length, 2, 'the baseline and one entry for three quick calls');
  assert.deepEqual(trail[0].tools, ['add_item', 'move_items', 'update_item']);

  await run(store, 'checkpoint', { project, label: 'after the prompt' });
  writeFileSync(join(store.dir(project), 'a.html'), '<body>edited by hand</body>'); // not through a tool
  await run(store, 'checkpoint', { project });
  trail = await run(store, 'history', { project });
  assert.equal(trail.length, 3, 'the hand edit became its own entry');
  assert.deepEqual(trail[0].tools, ['edited outside the tools']);
  assert.equal(trail[1].label, 'after the prompt');
  const afterEdit = read();

  await run(store, 'restore', { project, n: 1 });
  assert.equal(read(), origin);
  await run(store, 'restore', { project, n: trail[0].n });
  assert.equal(read(), afterEdit, 'a restore is undone by restoring the entry before it');
  assert.notEqual(afterEdit, afterTools);
  assert.ok((await run(store, 'history', { project }))[0].kind === 'restore');
  await call('move_items', { ids: ['a'], dx: 100 });
  const moved = read();
  await run(store, 'undo', { project });
  assert.equal(read(), afterEdit, 'undo reverts the latest change');
  await run(store, 'undo', { project });
  assert.equal(read(), moved, 'and undoing the undo redoes it');
});

test('doctor: a fresh init is in step; a stale skill is reported; a newer data format is refused', () => {
  const root = mkdtempSync(join(tmpdir(), 'framery-doctor-'));
  init({ dir: root });
  assert.equal(doctor({ dir: root }).ok, true);
  writeFileSync(join(root, '.claude/skills/framery/SKILL.md'), 'old');
  const stale = doctor({ dir: root });
  assert.ok(!stale.ok && /another version/.test(stale.problems[0]));
  init({ dir: root });
  assert.equal(doctor({ dir: root }).ok, true, 'init refreshes it');

  const base = new Store(join(root, 'framery'));
  const flows = join(base.dir(base.projects()[0]), 'pages', 'flows.json');
  writeFileSync(flows, JSON.stringify({ id: 'flows', items: [{ id: 'a', type: 'frame', src: 'gone.html' }], arrows: [{ id: 'x', from: 'a', to: 'nope' }] }));
  const found = doctor({ dir: root }).problems.join('; ');
  assert.match(found, /missing nope/);
  assert.match(found, /no file gone\.html/);
  writeFileSync(flows, JSON.stringify({ id: 'flows', items: [], arrows: [] }));

  const store = new Store(join(root, 'framery'));
  const [name] = store.projects();
  const file = join(store.dir(name), 'project.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), format: 99 }));
  assert.match(doctor({ dir: root }).problems.join(), /newer framery/);
  assert.throws(() => store.project(name), /newer framery/);
});
