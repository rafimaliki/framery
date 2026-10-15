// How framery ends what it started. The studio (and a `framery watch`) write their pid to a small file under
// <data>/.cache/; `framery stop` reads them, so an agent (or a person) ends a process properly instead of
// killing a task by hand and leaving a stale address behind.
//
// It never kills a pid it has not confirmed is framery's: the studio is asked over its own address (and
// only killed after it answered, if it then does not leave); a watcher counts only while its heartbeat is
// fresh. A pid file left by a process that is gone is cleared, not obeyed: pids are reused.

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const FILES = { 'studio.json': 'the studio', 'watch.json': 'the watcher' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const file = (root, name) => join(root, '.cache', name);

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM'; // it exists, it is just not ours to signal
  }
}

// The studio leaves: forget where it was, but only if the file still names this process.
export function forgetStudio(root) {
  try {
    if (JSON.parse(readFileSync(file(root, 'studio.json'), 'utf8')).pid === process.pid) rmSync(file(root, 'studio.json'), { force: true });
  } catch {
    // no file, or not ours to remove
  }
}

async function ends(pid, ms) {
  for (let waited = 0; alive(pid) && waited < ms; waited += 100) await sleep(100);
  return !alive(pid);
}

// What was stopped, as [{ what, pid, how }]; nothing running is an empty list, so it is safe to run twice.
// how: asked (the studio closed itself), ended (a watcher took the signal), forced (it ignored both),
// stale (the pid file was left by a process that is gone: cleared), not responding (alive but silent: left alone).
export async function stop(root, { wait = 3000 } = {}) {
  const stopped = [];
  for (const [name, what] of Object.entries(FILES)) {
    let info;
    try {
      info = JSON.parse(readFileSync(file(root, name), 'utf8'));
    } catch {
      continue; // not running
    }
    const { pid } = info;
    const clear = () => rmSync(file(root, name), { force: true });
    if (!Number.isInteger(pid) || !alive(pid)) {
      clear();
      stopped.push({ what, pid, how: 'stale' });
      continue;
    }
    if (info.url) {
      // the studio: it is framery only if it answers at its own address
      const post = (path, init) => fetch(`${info.url}${path}`, { signal: AbortSignal.timeout(2000), ...init });
      const answers = await post('/api/version').then((r) => r.ok, () => false);
      if (!answers) {
        stopped.push({ what, pid, how: 'not responding' });
        continue;
      }
      await post('/api/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
      // this process never ends itself (a studio started in-process, as the tests do)
      if (pid !== process.pid && !(await ends(pid, wait))) {
        process.kill(pid);
        if (!(await ends(pid, 1000))) process.kill(pid, 'SIGKILL');
        clear();
        stopped.push({ what, pid, how: 'forced' });
        continue;
      }
      clear();
      stopped.push({ what, pid, how: 'asked' });
    } else {
      // a watcher has no address: its heartbeat says whether this pid is still the watcher
      if (Date.now() - (info.at ?? 0) > 10000 || pid === process.pid) {
        clear();
        stopped.push({ what, pid, how: 'stale' });
        continue;
      }
      process.kill(pid);
      if (!(await ends(pid, wait))) process.kill(pid, 'SIGKILL');
      clear();
      stopped.push({ what, pid, how: 'ended' });
    }
  }
  return stopped;
}
