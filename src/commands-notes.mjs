// Notes: a person's comment pinned to one element of a screen, made in the player, read by the agent.
// They live in the project's notes.json. An agent lists the open ones, does the work, then resolves them.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkName, fail, readJson, writeJson } from './store.mjs';
import { cmd, project, t, where } from './kit.mjs';

const file = (store, name) => join(store.dir(name), 'notes.json');
const load = (store, name) => (existsSync(file(store, name)) ? readJson(file(store, name)) : []);

export const noteCommands = {
  add_note: cmd(
    'Pin a comment to a screen, or to one element of it. The studio calls this when a person comments in the player.',
    { ...where, item: t.str('frame id'), text: t.str('the comment'), selector: t.str('css selector of the element'), anchor: t.str('its id or data-anchor, when it has one'), html: t.str('the element\'s outer html, trimmed'), label: t.str('its visible text, trimmed') },
    ['item', 'text'],
    (store, a) => {
      const name = store.name(a.project);
      const page = a.page ?? store.project(name).pages?.[0]?.id;
      const frame = store.page(name, checkName('page', page)).items.find((i) => i.id === a.item);
      if (!frame || frame.type !== 'frame') fail(`${a.item} is not a frame on ${page}`);
      if (!String(a.text).trim()) fail('text is empty');
      const notes = load(store, name);
      const note = { id: `n${Math.max(0, ...notes.map((n) => +n.id.slice(1))) + 1}`, page, item: a.item, src: frame.src, text: String(a.text).trim(), selector: a.selector, anchor: a.anchor, html: a.html?.slice(0, 600), label: a.label?.slice(0, 120) };
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

  resolve_note: cmd('Remove a note once it is dealt with.', { project, id: t.str('note id, e.g. n3') }, ['id'], (store, a) => {
    const name = store.name(a.project);
    const notes = load(store, name);
    if (!notes.some((n) => n.id === a.id)) fail(`no note ${a.id}`);
    writeJson(file(store, name), notes.filter((n) => n.id !== a.id));
    return { resolved: a.id };
  }),
};
