// `framery watch`: print one line for every comment (note) that is open, when it appears, until stopped. An
// agent runs it under its harness's background monitor, so a comment made in the studio reaches it without
// anyone going back to the chat. While it runs it writes a heartbeat the studio reads, so the studio can
// tell "the agent has it" from "nobody is watching". Notes already open when it starts are printed first, so none are missed.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './commands.mjs';

const line = (n) => `NOTE ${n.id} on ${n.page}/${n.item} (${n.src}): ${n.text.replace(/\s+/g, ' ')} | element: ${n.selector ?? '-'} | text: ${n.label ?? '-'}`;

export function watch(store, { every = 1500 } = {}) {
  let seen = new Set();
  const beat = () => {
    try {
      mkdirSync(join(store.root, '.cache'), { recursive: true });
      writeFileSync(join(store.root, '.cache', 'watch.json'), JSON.stringify({ at: Date.now(), pid: process.pid }));
    } catch {
      // read-only folder: the studio then says nobody is watching
    }
  };
  const poll = async () => {
    beat();
    const open = [];
    for (const project of store.projects()) {
      try {
        for (const n of await run(store, 'list_notes', { project })) open.push([`${project}/${n.id}/${n.item}/${n.text}`, project, n]);
      } catch {
        // a project being rewritten: try again next time
      }
    }
    // keyed by content, since a resolved note's id is handed out again
    for (const [key, project, n] of open) if (!seen.has(key) && !n.question) console.log(store.projects().length > 1 ? `[${project}] ${line(n)}` : line(n));
    seen = new Set(open.map(([key]) => key));
  };
  poll();
  return setInterval(poll, every);
}
