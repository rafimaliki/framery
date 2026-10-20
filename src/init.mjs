// `framery init`: the one deliberate step that wires a project to framery. It copies the skill into the
// folders of the chosen coding agents only (see agents.mjs), registers the MCP server for them, keeps the
// generated folders out of git, and makes an empty data folder (framery/) when there is none. With
// `global` it puts the skill and server in the person's home folder instead and leaves the repo alone.
// Safe to run again: it refreshes, never duplicates.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS, detect, parseAgents, writeMcp } from './agents.mjs';
import { FORMAT, Store, readJson, writeJson } from './store.mjs';

const PKG = resolve(fileURLToPath(new URL('..', import.meta.url)));
const slash = (path) => path.split(sep).join('/');

// The agents a project chose, kept beside its projects so doctor checks the same ones.
export const chosenAgents = (root) => (existsSync(join(root, 'config.json')) ? readJson(join(root, 'config.json')).agents : undefined);

function copySkills(to) {
  const skills = join(PKG, 'skills');
  for (const name of readdirSync(skills)) {
    rmSync(join(to, name), { recursive: true, force: true });
    cpSync(join(skills, name), join(to, name), { recursive: true });
  }
}

export function init({ dir = '.', data, agents, global = false, home = homedir() } = {}) {
  const project = resolve(dir);
  const root = resolve(project, data ?? 'framery');
  const rel = slash(relative(project, root)) || '.';
  const done = [];
  const picked = agents ? parseAgents(agents) : (!global && chosenAgents(root)) || detect(project);
  const skipped = Object.keys(AGENTS).filter((a) => !picked.includes(a));

  if (global) {
    // in the home folder: run by npx and an absolute data path, so nothing depends on a repo's node_modules
    const server = { command: 'npx', args: ['framery', 'mcp', '--data', root] };
    for (const name of picked) {
      const at = AGENTS[name].home;
      copySkills(join(home, at.skills));
      done.push(`${name}: skills -> ~/${at.skills}`);
      if (at.mcp) {
        writeMcp(join(home, at.mcp), server);
        done.push(`${name}: MCP -> ~/${at.mcp} (npx framery mcp --data ${root})`);
      } else done.push(`${name}: no user-level MCP file known, add the server by hand (npx framery mcp --data ${root})`);
    }
    return { global: true, data: root, agents: picked, wrote: done, skipped };
  }

  for (const name of picked) {
    copySkills(join(project, AGENTS[name].skills));
    done.push(`${name}: skills -> ${AGENTS[name].skills}`);
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
  for (const file of new Set(picked.map((name) => AGENTS[name].mcp))) {
    writeMcp(join(project, file), server);
    done.push(`MCP -> ${file}`);
  }
  writeJson(join(root, 'config.json'), { agents: picked });

  // generated, never design data: previews and measurements, exports, the undo trail's blobs
  const ignore = join(project, '.gitignore');
  const have = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
  const lines = [`${rel}/**/.cache/`, `${rel}/**/exports/`, `${rel}/**/.history/`].filter((line) => !have.split(/\r?\n/).includes(line));
  if (lines.length) {
    writeFileSync(ignore, `${have}${have && !have.endsWith('\n') ? '\n' : ''}# framery: generated\n${lines.join('\n')}\n`);
    done.push('.gitignore');
  }

  return { dir: project, data: root, agents: picked, wrote: done, skipped };
}
