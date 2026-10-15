// `framery watch`: print one line for everything an agent should act on, when it appears, until stopped:
// a comment (NOTE) left on a screen, or a message (CHAT) written in the studio's chat. It is plain lines on
// stdout, so any agent that can run a background command and read its output can use it, under whatever
// monitor its harness has. `--once` prints what is waiting (or the next thing to arrive) and then exits,
// for an agent that can only run a command to completion and run it again.
// Work already waiting when it starts is printed first, so none is missed. While it runs it writes a
// heartbeat the studio reads, so the studio can tell "the agent has it" from "nobody is watching".

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './commands.mjs';
import { pending } from './commands-chat.mjs';

const flat = (text) => text.replace(/\s+/g, ' ');
const noteLine = (n) => `NOTE ${n.id} on ${n.page}/${n.item} (${n.src}): ${flat(n.text)} | element: ${n.selector ?? '-'} | text: ${n.label ?? '-'}`;
const chatLine = (m) => `CHAT ${m.id} [page ${m.page ?? '-'}, selected ${m.selected ?? '-'}]: ${flat(m.text)}`;

export function watch(store, { every = 1500, once = false } = {}) {
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
    const open = []; // [key, line]
    const names = store.projects();
    const tag = (project, line) => (names.length > 1 ? `[${project}] ${line}` : line);
    for (const project of names) {
      try {
        // a note with a question is waiting on the person, not on the agent
        for (const n of await run(store, 'list_notes', { project })) if (!n.question) open.push([`${project}/note/${n.id}/${n.item}/${n.text}`, tag(project, noteLine(n))]);
        for (const m of pending((await run(store, 'list_chat', { project, limit: 200 })).messages)) open.push([`${project}/chat/${m.id}`, tag(project, chatLine(m))]);
      } catch {
        // a project being rewritten: try again next time
      }
    }
    // keyed by content, since a resolved note's id is handed out again
    const fresh = open.filter(([key]) => !seen.has(key));
    for (const [, line] of fresh) console.log(line);
    seen = new Set(open.map(([key]) => key));
    if (once && fresh.length) clearInterval(timer); // nothing else keeps the process alive: it ends
  };
  const timer = setInterval(poll, every);
  poll();
  return timer;
}
