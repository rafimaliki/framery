// The project's undo trail. Every file of a project (except what is regenerated: .cache, exports) is kept
// as a gzipped blob named by its hash, so a version is stored once however many entries point at it.
// An entry records, per changed file, the hash before and after. Calls that follow each other closely
// (one prompt's worth) merge into one entry, so storage grows with what changed, not with how often
// a tool ran. Restoring writes a past state back and is itself an entry, so a restore can be undone.
//
//   <project>/.history/journal.json   entries, oldest first (the first is the baseline: every file, as it was)
//   <project>/.history/blobs/ab/<hash>.gz
//
// The command runner, the studio's watcher (edits made outside the tools) and the CLI all call record();
// they are separate processes, so a lock directory serialises them.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fail, readJson, writeJson } from './store.mjs';

export const WINDOW_MS = 20_000; // calls closer together than this are one prompt's work
const MAX_ENTRIES = 500; // beyond these, the oldest entries fold into the baseline
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILE = 5 * 1024 * 1024; // bigger files are not versioned
const SKIP_DIRS = new Set(['.cache', 'exports', '.history', 'node_modules']);

const hashOf = (buffer) => createHash('sha1').update(buffer).digest('hex');
const paths = (store, project) => {
  const dir = store.dir(project);
  return { dir, home: join(dir, '.history'), journal: join(dir, '.history', 'journal.json'), blobs: join(dir, '.history', 'blobs') };
};
const blobFile = (p, hash) => join(p.blobs, hash.slice(0, 2), `${hash}.gz`);

// ---- the files of a project ---------------------------------------------------------------------

// size and mtime say a file is the one already hashed, so a call re-reads only what changed
const seen = new Map(); // full path -> { stamp, hash }

function scan(dir) {
  const found = new Map(); // path -> { hash, full }
  (function walk(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (folder === dir && SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (!/\.tmp$/.test(entry.name)) {
        const info = statSync(full);
        if (info.size > MAX_FILE) continue;
        const stamp = `${info.size}:${info.mtimeMs}`;
        let known = seen.get(full);
        if (known?.stamp !== stamp) seen.set(full, (known = { stamp, hash: hashOf(readFileSync(full)) }));
        found.set(relative(dir, full).split(sep).join('/'), { hash: known.hash, full });
      }
    }
  })(dir);
  return found;
}

function keep(p, hash, full) {
  const file = blobFile(p, hash);
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, gzipSync(readFileSync(full), { level: 9 }));
}

function blob(p, hash) {
  const file = blobFile(p, hash);
  if (!existsSync(file)) fail(`history is missing version ${hash.slice(0, 8)}`);
  const buffer = gunzipSync(readFileSync(file));
  if (hashOf(buffer) !== hash) fail(`history version ${hash.slice(0, 8)} is damaged`);
  return buffer;
}

// ---- the journal ----------------------------------------------------------------------------------

const load = (p) => (existsSync(p.journal) ? readJson(p.journal) : []);

// The state after entry `index`: path -> hash.
function stateAt(entries, index) {
  const state = new Map();
  for (const entry of entries.slice(0, index + 1)) {
    for (const [path, [, after]] of Object.entries(entry.files)) {
      if (after) state.set(path, after);
      else state.delete(path);
    }
  }
  return state;
}

const hashes = (files) => new Map([...files].map(([path, { hash }]) => [path, hash]));

// Entries carry before/after per file; a file that ends where it began is not a change.
function diff(before, after) {
  const files = {};
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const [a, b] = [before.get(path) ?? null, after.get(path) ?? null];
    if (a !== b) files[path] = [a, b];
  }
  return files;
}

function withLock(p, work) {
  const lock = join(p.home, 'lock');
  mkdirSync(p.home, { recursive: true });
  for (let tries = 0; ; tries++) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - statSync(lock).mtimeMs > 30_000) rmSync(lock, { recursive: true, force: true }); // left by a crash
      else if (tries > 200) fail('history is busy');
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return work();
  } finally {
    rmdirSync(lock);
  }
}

function collect(p, entries) {
  const used = new Set(entries.flatMap((e) => Object.values(e.files).flat().filter(Boolean)));
  let bytes = 0;
  if (!existsSync(p.blobs)) return bytes;
  for (const bucket of readdirSync(p.blobs)) {
    for (const name of readdirSync(join(p.blobs, bucket))) {
      const file = join(p.blobs, bucket, name);
      if (!used.has(name.replace(/\.gz$/, ''))) rmSync(file);
      else bytes += statSync(file).size;
    }
  }
  return bytes;
}

// Fold the oldest entries into the baseline once there are too many, or too many bytes.
function squash(p, entries, bytes) {
  let cut = 0;
  if (entries.length > MAX_ENTRIES) cut = entries.length - MAX_ENTRIES + 50;
  else if (bytes > MAX_BYTES && entries.length > 20) cut = Math.ceil(entries.length / 10);
  if (!cut) return entries;
  const state = stateAt(entries, cut);
  const base = { ...entries[cut], kind: 'baseline', label: 'older history folded here', files: Object.fromEntries([...state].map(([path, hash]) => [path, [null, hash]])) };
  return [base, ...entries.slice(cut + 1)];
}

function save(p, entries) {
  writeJson(p.journal, entries);
  const bytes = collect(p, entries);
  const squashed = squash(p, entries, bytes);
  if (squashed !== entries) {
    writeJson(p.journal, squashed);
    collect(p, squashed);
  }
}

// ---- recording ------------------------------------------------------------------------------------

// Make sure a baseline exists, so the first change has something to be compared with.
export function begin(store, project) {
  const p = paths(store, project);
  if (existsSync(p.journal)) return;
  withLock(p, () => {
    if (existsSync(p.journal)) return;
    const files = scan(p.dir);
    const state = Object.fromEntries([...hashes(files)].map(([path, hash]) => [path, [null, hash]]));
    for (const [, { hash, full }] of files) keep(p, hash, full);
    save(p, [{ n: 1, kind: 'baseline', at: Date.now(), last: Date.now(), label: 'before history began', tools: [], files: state }]);
  });
}

// Note what changed since the last entry. `tool` names the command that just ran; null means the
// change came from outside the tools (an editor, the agent's own file edits).
export function record(store, project, tool = null, now = Date.now()) {
  const p = paths(store, project);
  begin(store, project);
  return withLock(p, () => {
    const entries = load(p);
    const files = scan(p.dir);
    const changes = diff(stateAt(entries, entries.length - 1), hashes(files));
    if (!Object.keys(changes).length) return null;
    for (const [path, [, after]] of Object.entries(changes)) if (after) keep(p, after, files.get(path).full);
    const last = entries[entries.length - 1];
    const label = tool ?? 'edited outside the tools';
    if (last.kind === 'edit' && !last.closed && now - last.last < WINDOW_MS) {
      for (const [path, [a, b]] of Object.entries(changes)) {
        const first = last.files[path] ? last.files[path][0] : a;
        if (first === b) delete last.files[path];
        else last.files[path] = [first, b];
      }
      last.last = now;
      if (!last.tools.includes(label)) last.tools.push(label);
      if (!Object.keys(last.files).length) entries.pop();
    } else {
      entries.push({ n: Math.max(...entries.map((e) => e.n)) + 1, kind: 'edit', at: now, last: now, tools: [label], files: changes });
    }
    save(p, entries);
    return entries[entries.length - 1]?.n ?? null;
  });
}

// ---- reading and going back -----------------------------------------------------------------------

export function list(store, project, limit = 50) {
  const p = paths(store, project);
  begin(store, project);
  const entries = load(p);
  return entries
    .slice()
    .reverse()
    .slice(0, limit)
    .map(({ n, kind, at, last, label, tools, closed, to, files }) => ({
      n,
      kind,
      at,
      last,
      label,
      tools,
      closed: !!closed,
      to,
      files: Object.entries(files).map(([path, [a, b]]) => ({ path, change: !a ? 'added' : !b ? 'deleted' : 'changed' })),
    }));
}

// A named stopping point: what happens next is a new entry.
export function checkpoint(store, project, label) {
  const p = paths(store, project);
  record(store, project);
  return withLock(p, () => {
    const entries = load(p);
    const last = entries[entries.length - 1];
    if (label) last.label = label;
    last.closed = true;
    save(p, entries);
    return { n: last.n };
  });
}

// Put the project back as it was right after entry `n`. The current state is saved first and the
// restore is an entry of its own, so nothing is lost and going back is itself undoable.
export function restore(store, project, n) {
  const p = paths(store, project);
  record(store, project);
  return withLock(p, () => {
    const entries = load(p);
    const index = entries.findIndex((e) => e.n === n);
    if (index < 0) fail(`no history entry ${n}`);
    const target = stateAt(entries, index);
    const current = stateAt(entries, entries.length - 1);
    const files = diff(current, target);
    // read every version first: a damaged one stops the restore before it changes anything
    const versions = new Map(Object.entries(files).filter(([, [, b]]) => b).map(([path, [, b]]) => [path, blob(p, b)]));
    for (const [path, [, after]] of Object.entries(files)) {
      const file = join(p.dir, path);
      if (after) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, versions.get(path));
      } else rmSync(file, { force: true });
    }
    if (Object.keys(files).length) {
      const at = Date.now();
      entries.push({ n: Math.max(...entries.map((e) => e.n)) + 1, kind: 'restore', at, last: at, label: `restored to #${n}`, to: n, tools: [], closed: true, files });
      save(p, entries);
    }
    return { restoredTo: n, files: Object.keys(files).length };
  });
}

// Revert the latest entry: the state as it was before it. Doing it again undoes the undo.
export function undo(store, project) {
  const p = paths(store, project);
  record(store, project);
  const entries = load(p);
  if (entries.length < 2) fail('nothing to undo');
  const last = entries[entries.length - 1];
  return { undone: last.tools.join(', ') || last.label, ...restore(store, project, entries[entries.length - 2].n) };
}
