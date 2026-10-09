// `framery init`: the one deliberate step that wires a project to framery. It copies the skills into
// the places agents look (.claude/skills, .omp/skills), registers the MCP server in .mcp.json, keeps the
// generated folders out of git, and makes an empty data folder (framery/) when there is none. Safe to
// run again: it refreshes, never duplicates.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMAT, Store, writeJson } from './store.mjs';

const PKG = resolve(fileURLToPath(new URL('..', import.meta.url)));
const slash = (path) => path.split(sep).join('/');

export function init({ dir = '.', data } = {}) {
  const project = resolve(dir);
  const root = resolve(project, data ?? 'framery');
  const rel = slash(relative(project, root)) || '.';
  const done = [];

  const skills = join(PKG, 'skills');
  for (const target of ['.claude/skills', '.omp/skills']) {
    for (const name of readdirSync(skills)) {
      const to = join(project, target, name);
      rmSync(to, { recursive: true, force: true });
      cpSync(join(skills, name), to, { recursive: true });
    }
    done.push(`skills -> ${target}`);
  }

  const store = new Store(root);
  if (!store.projects().length) {
    const name = basename(project).replace(/[^\w.-]+/g, '-') || 'project';
    const base = join(root, name);
    mkdirSync(join(base, 'pages'), { recursive: true });
    writeJson(join(base, 'project.json'), { format: FORMAT, title: basename(project), tokens: 'tokens.css', pages: [{ id: 'flows', title: 'Flows' }] });
    writeJson(join(base, 'pages', 'flows.json'), { id: 'flows', title: 'Flows', items: [], arrows: [] });
    writeFileSync(join(base, 'tokens.css'), ':root {\n  --paper: #f4f1ea;\n  --ink: #16161a;\n  --accent: #7a1f5c;\n}\n');
    done.push(`empty project ${slash(relative(project, base))}`);
  }

  // Installed in this project: run it by path (the same on every OS, nothing for the agent to spawn through
  // a shell). Installed elsewhere: npx.
  const server = PKG.startsWith(project + sep)
    ? { command: 'node', args: [slash(relative(project, join(PKG, 'bin', 'framery.mjs'))), 'mcp', '--data', rel] }
    : { command: 'npx', args: ['framery', 'mcp', '--data', rel] };
  const file = join(project, '.mcp.json');
  const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  config.mcpServers = { ...config.mcpServers, framery: server };
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  done.push('.mcp.json');

  // generated, never design data: previews and measurements, exports, the undo trail's blobs
  const ignore = join(project, '.gitignore');
  const have = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
  const lines = [`${rel}/**/.cache/`, `${rel}/**/exports/`, `${rel}/**/.history/`].filter((line) => !have.split(/\r?\n/).includes(line));
  if (lines.length) {
    writeFileSync(ignore, `${have}${have && !have.endsWith('\n') ? '\n' : ''}# framery: generated\n${lines.join('\n')}\n`);
    done.push('.gitignore');
  }

  return { dir: project, data: root, wrote: done };
}
