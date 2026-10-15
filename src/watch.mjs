// `framery watch`: print one line for every comment (note) that is open, when it appears, until stopped. An
// agent runs it under its harness's background monitor, so a comment made in the studio reaches it without
// anyone going back to the chat. Notes already open when it starts are printed first, so none are missed.

import { run } from './commands.mjs';

const line = (n) => `NOTE ${n.id} on ${n.page}/${n.item} (${n.src}): ${n.text.replace(/\s+/g, ' ')} | element: ${n.selector ?? '-'} | text: ${n.label ?? '-'}`;

export function watch(store, { every = 1500 } = {}) {
  let seen = new Set();
  const poll = async () => {
    const open = [];
    for (const project of store.projects()) {
      try {
        for (const n of await run(store, 'list_notes', { project })) open.push([`${project}/${n.id}/${n.item}/${n.text}`, project, n]);
      } catch {
        // a project being rewritten: try again next time
      }
    }
    // keyed by content, since a resolved note's id is handed out again
    for (const [key, project, n] of open) if (!seen.has(key)) console.log(store.projects().length > 1 ? `[${project}] ${line(n)}` : line(n));
    seen = new Set(open.map(([key]) => key));
  };
  poll();
  return setInterval(poll, every);
}
