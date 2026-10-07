#!/usr/bin/env node
// framery [serve] | mcp | init | doctor | version | render | cmd <name> [json] | tools     (--data DIR, --port N)

import { resolve } from 'node:path';
import { Store, FramError } from '../src/store.mjs';
import { commands, run } from '../src/commands.mjs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at < 0 ? undefined : argv.splice(at, 2)[1];
};
const has = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv.splice(at, 1).length > 0;
};

// The data root: --data, FRAMERY_DATA, else ./framery in the project this is run from.
// Flags are read before the command, so they may come first or last.
const data = flag('data');
const dataRoot = () => resolve(data ?? process.env.FRAMERY_DATA ?? 'framery');

const asked = flag('port') ?? process.env.PORT;
const port = Number(asked ?? 4173);
const quiet = has('no-render');
const force = has('force');
const project = flag('project');
const [command = 'serve', ...rest] = argv;

try {
  if (command === 'serve') {
    const { serve } = await import('../src/server.mjs');
    serve({ root: dataRoot(), port, strict: asked != null, autoRender: !quiet });
  } else if (command === 'mcp') {
    (await import('../src/mcp.mjs')).mcp({ root: dataRoot() });
  } else if (command === 'init') {
    const { init } = await import('../src/init.mjs');
    console.log(JSON.stringify(init({ dir: flag('dir') ?? '.', data }), null, 2));
  } else if (command === 'doctor') {
    const { doctor } = await import('../src/doctor.mjs');
    const report = doctor({ dir: flag('dir') ?? '.', data: data ?? 'framery' });
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  } else if (command === 'version' || command === '--version') {
    console.log((await import('../src/doctor.mjs')).version());
  } else if (command === 'render') {
    console.log(JSON.stringify(await run(new Store(dataRoot()), 'render_frames', { project, force }), null, 2));
  } else if (command === 'tools') {
    for (const [name, c] of Object.entries(commands)) console.log(`${name.padEnd(16)} ${c.description}`);
  } else if (command === 'cmd') {
    const [name, args] = rest;
    const out = await run(new Store(dataRoot()), name, args ? JSON.parse(args) : {});
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
  } else {
    console.error('usage: framery [serve|mcp|init|doctor|version|render|tools|cmd <name> [json]] [--data DIR] [--port N] [--project P]');
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof FramError ? error.message : error);
  process.exit(1);
}
