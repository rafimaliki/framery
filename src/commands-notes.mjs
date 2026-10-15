// Notes: a person's comment pinned to one element of a screen, made in the player, read by the agent.
// They live in the project's notes.json. An agent lists the open ones, does the work, then resolves them.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkName, fail, readJson, writeJson } from './store.mjs';
import { cmd, project, t, where } from './kit.mjs';

const file = (store, name) => join(store.dir(name), 'notes.json');
const load = (store, name) => (existsSync(file(store, name)) ? readJson(file(store, name)) : []);

// Change one note and save: the shape ask_note and reply_note share.
function change(store, a, edit) {
  const name = store.name(a.project);
  const notes = load(store, name);
  const note = notes.find((n) => n.id === a.id);
  if (!note) fail(`no note ${a.id}`);
  edit(note);
  writeJson(file(store, name), notes);
  return note;
}

export const noteCommands = {
  add_note: cmd(
    'Pin a comment to a screen, or to one element of it. The studio calls this when a person comments in the player.',
    { ...where, item: t.str('frame id'), text: t.str('the comment'), selector: t.str('css selector of the element'), anchor: t.str('its id or data-anchor, when it has one'), html: t.str('the element\'s outer html, trimmed'), label: t.str('its visible text, trimmed'), box: { type: 'array', items: { type: 'number' }, description: '[x, y, w, h] of the element in the screen own pixels; where the studio pins it' } },
    ['item', 'text'],
    (store, a) => {
      const name = store.name(a.project);
      const page = a.page ?? store.project(name).pages?.[0]?.id;
      const frame = store.page(name, checkName('page', page)).items.find((i) => i.id === a.item);
      if (!frame || frame.type !== 'frame') fail(`${a.item} is not a frame on ${page}`);
      if (!String(a.text).trim()) fail('text is empty');
      const notes = load(store, name);
      const note = { id: `n${Math.max(0, ...notes.map((n) => +n.id.slice(1))) + 1}`, page, item: a.item, src: frame.src, text: String(a.text).trim(), selector: a.selector, anchor: a.anchor, html: a.html?.slice(0, 600), label: a.label?.slice(0, 120), box: Array.isArray(a.box) && a.box.length === 4 && a.box.every(Number.isFinite) ? a.box : undefined };
      writeJson(file(store, name), [...notes, Object.fromEntries(Object.entries(note).filter(([, v]) => v !== undefined))]);
      return note;
    },
  ),

  list_notes: cmd(
    'The open notes: what a person flagged in the player. Each says which screen file (src), the element (anchor or selector, plus its html) and the comment. Do the work, then resolve_note.',
    { ...where, item: t.str('only this frame') },
    [],
    (store, a) => load(store, store.name(a.project)).filter((n) => (!a.item || n.item === a.item) && (!a.page || n.page === a.page)),
  ),

  ask_note: cmd(
    'A note is too vague to act on: ask the person, right on the note. The studio shows the question on its pin and they answer there; the answer is added to the note text and comes back through watch as an open note again. Use this, not silence and not the chat, so a note is never left hanging.',
    { project, id: t.str('note id'), question: t.str('one short, specific question') },
    ['id', 'question'],
    (store, a) => {
      if (!String(a.question).trim()) fail('question is empty');
      return change(store, a, (n) => (n.question = String(a.question).trim()));
    },
  ),

  reply_note: cmd(
    'The person answers the question on a note. The studio calls this.',
    { project, id: t.str('note id'), text: t.str('the answer') },
    ['id', 'text'],
    (store, a) => {
      if (!String(a.text).trim()) fail('text is empty');
      return change(store, a, (n) => {
        if (!n.question) fail(`note ${a.id} asked nothing`);
        n.text = `${n.text}

Q: ${n.question}
A: ${String(a.text).trim()}`;
        delete n.question;
      });
    },
  ),

  resolve_note: cmd('Remove a note once it is dealt with.', { project, id: t.str('note id, e.g. n3') }, ['id'], (store, a) => {
    const name = store.name(a.project);
    const notes = load(store, name);
    if (!notes.some((n) => n.id === a.id)) fail(`no note ${a.id}`);
    writeJson(file(store, name), notes.filter((n) => n.id !== a.id));
    return { resolved: a.id };
  }),
};
