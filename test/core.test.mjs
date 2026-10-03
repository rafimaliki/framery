// The checks that fail if framery's core breaks: commands, validation, layout, MCP framing and the
// package's own init. Run: node --test framery/test

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../src/commands.mjs';
import { findBrowser } from '../src/browser.mjs';
import { doctor } from '../src/doctor.mjs';
import { init } from '../src/init.mjs';
import { Store } from '../src/store.mjs';

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
  const a = (await call('add_item', { type: 'frame', title: 'Screen A', src: 'a.html' })).item;
  const b = (await call('add_item', { type: 'frame', title: 'Screen B', src: 'b.html', device: 'desktop' })).item;
  assert.equal(a.id, 'screen-a');
  assert.deepEqual([a.w, a.h, b.w, b.h], [390, 844, 1280, 800]);
  assert.ok(b.x >= a.x + a.w, 'a new frame lands right of its neighbour');
});

test('arrows anchor to elements that exist, and only those', async () => {
  const { call } = scratch();
  await call('add_item', { type: 'frame', id: 'a', src: 'a.html' });
  await call('add_item', { type: 'frame', id: 'b', src: 'b.html' });
  const ok = await call('connect', { from: 'a#go-a', to: 'b', label: 'tap Go', tone: 'positive' });
  assert.equal(ok.arrow.from, 'a#go-a');
  await assert.rejects(call('connect', { from: 'a#nope', to: 'b' }), /no element "nope"/);
  await assert.rejects(call('connect', { from: 'a', to: 'ghost' }), /no item "ghost"/);
  await assert.rejects(call('connect', { from: 'a', to: 'b', tone: 'blue' }), /tone must be/);
});

test('a group wraps its members, moves them with it, and removing an item drops its arrows', async () => {
  const { call } = scratch();
  await call('add_item', { type: 'frame', id: 'a', src: 'a.html', x: 0, y: 0 });
  await call('add_item', { type: 'frame', id: 'b', src: 'b.html', x: 600, y: 0 });
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
  await call('add_item', { type: 'frame', id: 'a', src: 'a.html', x: 900, y: 0, description: 'First.' });
  await call('add_item', { type: 'frame', id: 'b', src: 'b.html', x: 0, y: 0, description: 'Second.' });
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
  await call('add_item', { type: 'frame', id: 'a', src: 'a.html' });
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

test('paths cannot leave the project', async () => {
  const { call } = scratch();
  await assert.rejects(call('add_item', { type: 'frame', src: '../../etc/passwd' }), /leaves the project|no file/);
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
  await call('add_item', { type: 'frame', id: 'a', src: 'a.html' });
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
