// The undo trail's commands (history.mjs does the work). They sit in the shared command table.

import { cmd, project, t } from './kit.mjs';
import { checkpoint, list, restore, undo } from './history.mjs';

export const historyCommands = {
  history: cmd(
    'The undo trail of a project, newest first: what each prompt changed (tools and files). Use restore to go back.',
    { project, limit: t.num('how many entries; default 50') },
    [],
    (store, a) => list(store, store.name(a.project), a.limit ?? 50),
  ),

  checkpoint: cmd(
    'Close the current history entry with a name, so what you do next is a separate step. Call it at the start of a task.',
    { project, label: t.str('what the step before it was') },
    [],
    (store, a) => checkpoint(store, store.name(a.project), a.label),
  ),

  undo: cmd(
    'Undo the latest change (everything the last prompt did, or the last restore). The safe way to answer "undo that": it is recorded, so calling undo again redoes it. For going further back, pick an entry from history and restore it.',
    { project },
    [],
    (store, a) => undo(store, store.name(a.project)),
  ),

  restore: cmd(
    'Put the project back as it was right after history entry n (the first entry is the state before history began). The current state is kept as an entry first, so a restore can itself be undone.',
    { project, n: t.num('history entry number') },
    ['n'],
    (store, a) => restore(store, store.name(a.project), a.n),
  ),
};
