// `framery init`: the one deliberate step that wires a project to framery. It copies the skills into
// the places agents look (.claude/skills, .omp/skills), points every other agent at them from AGENTS.md,
// registers the MCP server in .mcp.json, keeps the generated folders out of git, and makes an empty data
// folder (framery/) when there is none. Safe to run again: it refreshes, never duplicates.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMAT, Store, writeJson } from './store.mjs';

const PKG = resolve(fileURLToPath(new URL('..', import.meta.url)));
const slash = (path) => path.split(sep).join('/');

// Agents that look in neither skill folder (Codex, Cursor, Copilot, Gemini CLI, ...) read AGENTS.md. Init keeps
// one marked block there that points them at the skill and the shell commands; text outside it is never touched.
const START = '<!-- framery:start -->';
const END = '<!-- framery:end -->';

export function agentsBlock(rel) {
  const data = rel === 'framery' ? '' : ` --data ${rel}`;
  return [
    START,
    '## Design (framery)',
    '',
    `Screens, flows, the design system and the plan live in \`${rel}/\`. Change them through framery's tools, never by hand.`,
    'Before any design work, read `.claude/skills/framery/SKILL.md`: what each tool does and when to reach for it.',
    'The tools: the `framery` MCP server in `.mcp.json`, or from a shell, `npx framery tools` lists them and',
    `\`npx framery cmd <tool> '<json>'${data}\` runs one. The person reviews in the studio: \`npx framery${data}\`.`,
    END,
  ].join('\n');
}

export function withAgentsBlock(text, block) {
  const at = text.indexOf(START);
  const end = at < 0 ? -1 : text.indexOf(END, at);
  if (end >= 0) return text.slice(0, at) + block + text.slice(end + END.length);
  return text.trim() ? `${text.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

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

  const agents = join(project, 'AGENTS.md');
  writeFileSync(agents, withAgentsBlock(existsSync(agents) ? readFileSync(agents, 'utf8') : '', agentsBlock(rel)));
  done.push('AGENTS.md');

  const store = new Store(root);
  if (!store.projects().length) {
    const name = basename(project).replace(/[^\w.-]+/g, '-') || 'project';
    const base = join(root, name);
    mkdirSync(join(base, 'pages'), { recursive: true });
    writeJson(join(base, 'project.json'), { format: FORMAT, title: basename(project), tokens: 'tokens.css', pages: [{ id: 'flows', title: 'Flows' }] });
    writeJson(join(base, 'pages', 'flows.json'), { id: 'flows', title: 'Flows', items: [], arrows: [] });
    writeFileSync(join(base, 'tokens.css'), ':root {\n  --paper: #f4f1ea;\n  --ink: #16161a;\n  --accent: #ef4b23;\n}\n');
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
