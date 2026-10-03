// `framery doctor`: what is installed, and whether this project is in step with it. It reads files only and
// never touches the network, so an upgrade is always a choice the person makes (see "Updating" in the README):
// install another version, run `framery init` to refresh the skills, run doctor to confirm.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMAT, Store, readJson } from './store.mjs';

const PKG = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const version = () => JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version;

const same = (a, b) => existsSync(a) && existsSync(b) && readFileSync(a, 'utf8') === readFileSync(b, 'utf8');

export function doctor({ dir = '.', data = 'framery' } = {}) {
  const project = resolve(dir);
  const problems = [];
  const skill = join(PKG, 'skills', 'framery', 'SKILL.md');
  for (const target of ['.claude/skills', '.omp/skills']) {
    const have = join(project, target, 'framery', 'SKILL.md');
    if (!existsSync(have)) problems.push(`no skill in ${target}: run framery init`);
    else if (!same(skill, have)) problems.push(`the skill in ${target} is from another version: run framery init`);
  }
  const mcp = join(project, '.mcp.json');
  if (!existsSync(mcp) || !JSON.parse(readFileSync(mcp, 'utf8')).mcpServers?.framery) problems.push('no framery entry in .mcp.json: run framery init');

  const root = resolve(project, data);
  const projects = existsSync(root) ? new Store(root).projects() : [];
  if (!projects.length) problems.push(`no project in ${data}/: run framery init`);
  const store = new Store(root);
  const formats = projects.map((name) => ({ name, format: readJson(join(store.dir(name), 'project.json')).format ?? 1 }));
  for (const p of formats) if (p.format > FORMAT) problems.push(`${p.name} was saved by a newer framery (format ${p.format}, this one reads up to ${FORMAT}): install a newer version`);
  return { version: version(), format: FORMAT, projects: formats, ok: !problems.length, problems };
}
