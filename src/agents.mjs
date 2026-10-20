// The coding agents framery can wire up, as data: adding one is a row here. For each, where it reads project
// skills and an MCP server from, and the same two for a person's own home folder (`framery init --global`).
// Paths checked against each tool's docs, October 2026. omp has no user-level MCP file we know of (null),
// and is assumed to read the Claude-style `.mcp.json` in a project.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

export const AGENTS = {
  claude: { cli: 'claude', skills: '.claude/skills', mcp: '.mcp.json', home: { skills: '.claude/skills', mcp: '.claude.json' } },
  codex: { cli: 'codex', skills: '.agents/skills', mcp: '.codex/config.toml', home: { skills: '.agents/skills', mcp: '.codex/config.toml' }, markers: ['.agents', '.codex'] },
  omp: { cli: 'omp', skills: '.omp/skills', mcp: '.mcp.json', home: { skills: '.omp/agent/skills', mcp: null } },
};

export function parseAgents(list) {
  const names = String(list).split(',').map((s) => s.trim()).filter(Boolean);
  const bad = names.filter((n) => !AGENTS[n]);
  if (bad.length || !names.length) throw new Error(`--agents takes ${Object.keys(AGENTS).join(', ')} (comma separated), not ${list}`);
  return [...new Set(names)];
}

const onPath = (cli) => (process.env.PATH ?? '').split(delimiter).some((dir) => dir && ['', '.exe', '.cmd'].some((ext) => existsSync(join(dir, cli + ext))));

// Agents this project is already set up for or that are installed here; never "all", claude when nothing shows.
export function detect(project) {
  const found = Object.entries(AGENTS)
    .filter(([name, a]) => (a.markers ?? [`.${name}`]).some((m) => existsSync(join(project, m))) || onPath(a.cli))
    .map(([name]) => name);
  return found.length ? found : ['claude'];
}

const table = 'mcp_servers.framery';
const toml = (server) => `[${table}]\ncommand = ${JSON.stringify(server.command)}\nargs = ${JSON.stringify(server.args)}\n`;

// Add (or replace) the framery server in an agent's MCP file, keeping everything else in it.
export function writeMcp(file, server) {
  mkdirSync(dirname(file), { recursive: true });
  const have = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (file.endsWith('.toml')) {
    const rest = have.replace(/^\[mcp_servers\.framery\][^\n]*\n(?:(?!\[)[^\n]*\n?)*/m, '').trimEnd();
    writeFileSync(file, `${rest ? `${rest}\n\n` : ''}${toml(server)}`);
  } else {
    const config = have ? JSON.parse(have) : {};
    config.mcpServers = { ...config.mcpServers, framery: server };
    writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  }
}

export function hasMcp(file) {
  if (!existsSync(file)) return false;
  const text = readFileSync(file, 'utf8');
  return file.endsWith('.toml') ? text.includes(`[${table}]`) : !!JSON.parse(text).mcpServers?.framery;
}
