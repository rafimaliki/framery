// `framery doctor`: what is installed, and whether this project is in step with it. It reads files only and
// never touches the network, so an upgrade is always a choice the person makes (see "Updating" in the README):
// install another version, run `framery init` to refresh the skills, run doctor to confirm.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS, hasMcp, parseAgents } from './agents.mjs';
import { chosenAgents } from './init.mjs';
import { FORMAT, Store, readJson } from './store.mjs';

const PKG = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const version = () => JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version;

const same = (a, b) => existsSync(a) && existsSync(b) && readFileSync(a, 'utf8') === readFileSync(b, 'utf8');

// The agents to check: the ones named, else the ones the project recorded, else the ones with a skill folder.
export function doctor({ dir = '.', data = 'framery', agents, global = false, home = homedir() } = {}) {
  const project = resolve(dir);
  const problems = [];
  const base = global ? home : project;
  const at = (name) => (global ? AGENTS[name].home : AGENTS[name]);
  const names = agents ? parseAgents(agents) : (!global && chosenAgents(resolve(project, data))) || Object.keys(AGENTS).filter((n) => existsSync(join(base, at(n).skills, 'framery')));
  if (!names.length) problems.push(`no skill installed for any agent: run framery init${global ? ' --global' : ''}`);
  const skill = join(PKG, 'skills', 'framery', 'SKILL.md');
  for (const name of names) {
    const { skills, mcp } = at(name);
    const have = join(base, skills, 'framery', 'SKILL.md');
    if (!existsSync(have)) problems.push(`${name}: no skill in ${skills}: run framery init`);
    else if (!same(skill, have)) problems.push(`${name}: the skill in ${skills} is from another version: run framery init`);
    if (mcp && !hasMcp(join(base, mcp))) problems.push(`${name}: no framery entry in ${mcp}: run framery init`);
  }

  const root = resolve(project, data);
  const projects = existsSync(root) ? new Store(root).projects() : [];
  if (!projects.length) problems.push(`no project in ${data}/: run framery init`);
  const store = new Store(root);
  const formats = projects.map((name) => ({ name, format: readJson(join(store.dir(name), 'project.json')).format ?? 1 }));
  for (const p of formats) if (p.format > FORMAT) problems.push(`${p.name} was saved by a newer framery (format ${p.format}, this one reads up to ${FORMAT}): install a newer version`);
  // the design itself: every arrow ends on an item that exists, every frame's file is there
  for (const { name, format } of formats) {
    if (format > FORMAT) continue;
    for (const { id } of store.project(name).pages ?? []) {
      const page = store.page(name, id);
      const ids = new Set(page.items.map((item) => item.id));
      for (const arrow of page.arrows) for (const end of [arrow.from, arrow.to]) if (!ids.has(end.split('#')[0])) problems.push(`${name}/${id}: arrow ${arrow.id} ends on missing ${end}`);
      for (const item of page.items) if (item.type === 'frame' && !existsSync(store.inside(name, item.src))) problems.push(`${name}/${id}: frame ${item.id} has no file ${item.src}`);
    }
  }
  return { version: version(), format: FORMAT, projects: formats, ok: !problems.length, problems };
}
