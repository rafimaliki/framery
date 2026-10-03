// The data root: a folder of projects. One project is a folder with a project.json, page files under
// pages/, and whatever the frames need (html, css, images). Nothing in here
// knows what a frame looks like; it reads and writes JSON and refuses paths that leave the project.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';

const NAME = /^[A-Za-z0-9][\w.-]*$/;

// The data format this version reads and writes. A project saved by a newer one is refused, not guessed at;
// an older one would be brought forward by a migration step (none yet: every project so far is format 1).
export const FORMAT = 1;

export class FramError extends Error {}

export function fail(message) {
  throw new FramError(message);
}

export function checkName(kind, name) {
  if (typeof name !== 'string' || !NAME.test(name)) fail(`${kind} must match ${NAME}: ${JSON.stringify(name)}`);
  return name;
}

// Pretty enough to review in a diff: one item or arrow per line, everything else indented.
export function format(value) {
  const list = (key) => (value[key] ?? []).map((entry) => '  ' + JSON.stringify(entry)).join(',\n');
  if (!('items' in value)) return JSON.stringify(value, null, 2) + '\n';
  const { items, arrows, ...rest } = value;
  const head = Object.entries(rest).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{\n${head.join(',\n')}${head.length ? ',\n' : ''}  "items": [\n${list('items').replace(/^ {2}/gm, '    ')}\n  ],\n  "arrows": [\n${list('arrows').replace(/^ {2}/gm, '    ')}\n  ]\n}\n`;
}

export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const text = format(value);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  // Swapping the file in is atomic, but on Windows the swap is refused while a reader (the studio
  // serving it, say) has the old file open. Retry briefly, then write in place.
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return renameSync(temp, file);
    } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
    }
  }
  writeFileSync(file, text);
  rmSync(temp, { force: true });
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export class Store {
  constructor(root) {
    this.root = resolve(root);
  }

  projects() {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(this.root, entry.name, 'project.json')))
      .map((entry) => entry.name);
  }

  // A missing project name is fine when there is exactly one.
  name(project) {
    const names = this.projects();
    if (project) {
      if (!names.includes(project)) fail(`no project ${JSON.stringify(project)}; have: ${names.join(', ') || 'none'}`);
      return project;
    }
    if (names.length === 1) return names[0];
    fail(`say which project: ${names.join(', ') || 'none exist'}`);
  }

  dir(project) {
    return join(this.root, this.name(project));
  }

  project(project) {
    const info = readJson(join(this.dir(project), 'project.json'));
    if ((info.format ?? 1) > FORMAT) fail(`${this.name(project)} was saved by a newer framery (data format ${info.format}; this version reads up to ${FORMAT}). Install a newer framery.`);
    return info;
  }

  saveProject(project, data) {
    writeJson(join(this.dir(project), 'project.json'), data);
  }

  pageFile(project, page) {
    return join(this.dir(project), 'pages', `${checkName('page', page)}.json`);
  }

  page(project, page) {
    const file = this.pageFile(project, page);
    if (!existsSync(file)) fail(`no page ${JSON.stringify(page)} in ${this.name(project)}`);
    return readJson(file);
  }

  savePage(project, page, data) {
    writeJson(this.pageFile(project, page), data);
  }

  // A path inside the project, or an error: frames and tokens never reach outside their folder.
  inside(project, path) {
    const base = this.dir(project);
    const full = resolve(base, path);
    const rel = relative(base, full);
    if (rel.startsWith('..') || isAbsolute(rel)) fail(`path leaves the project: ${path}`);
    return full;
  }

  mtime(file) {
    try {
      return statSync(file).mtimeMs;
    } catch {
      return 0;
    }
  }
}
