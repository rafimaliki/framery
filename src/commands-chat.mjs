// The studio's chat: a person writes to the agent from the browser, the agent answers with reply_chat. The
// messages live in the project's chat.json. A message is unanswered until the agent's next reply, so the
// agent (through `framery watch`) and the studio both know what is waiting without any extra state.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fail, readJson, writeJson } from './store.mjs';
import { cmd, project, t } from './kit.mjs';

const KEEP = 200; // the oldest messages go, so the file stays small
const file = (store, name) => join(store.dir(name), 'chat.json');
const load = (store, name) => (existsSync(file(store, name)) ? readJson(file(store, name)) : []);

// The person's messages since the agent last spoke.
export const pending = (messages) => messages.slice(messages.findLastIndex((m) => m.role === 'agent') + 1).filter((m) => m.role === 'user');

// ponytail: read, append, write with no lock: two writers within the same few milliseconds can drop one message. A lock file if that ever shows.
function add(store, a, role, extra = {}) {
  const name = store.name(a.project);
  const text = String(a.text ?? '').trim();
  if (!text) fail('text is empty');
  const messages = load(store, name);
  const message = { id: `c${Math.max(0, ...messages.map((m) => +m.id.slice(1))) + 1}`, role, text: text.slice(0, 4000), at: Date.now(), ...extra };
  writeJson(file(store, name), [...messages, message].slice(-KEEP));
  return message;
}

export const chatCommands = {
  send_chat: cmd(
    'A person writes to the agent from the studio chat (the studio calls this; agents answer with reply_chat). page and selected say where they were looking, so "make this bigger" has a "this".',
    { project, text: t.str('the message'), page: t.str('page id the person has open'), selected: t.str('item id they have selected') },
    ['text'],
    (store, a) => add(store, a, 'user', Object.fromEntries(Object.entries({ page: a.page, selected: a.selected }).filter(([, v]) => v))),
  ),

  list_chat: cmd(
    'The studio chat, oldest first. pending is what the person has sent since your last reply_chat.',
    { project, limit: t.num('how many of the latest messages; default 50') },
    [],
    (store, a) => {
      const messages = load(store, store.name(a.project));
      return { messages: messages.slice(-(a.limit ?? 50)), pending: pending(messages).map((m) => m.id) };
    },
  ),

  reply_chat: cmd(
    'Answer in the studio chat. It answers every message the person has sent so far, so say what you did or what you need. Always reply, even to decline.',
    { project, text: t.str('your answer, plain text') },
    ['text'],
    (store, a) => add(store, a, 'agent'),
  ),
};
