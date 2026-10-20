// The composition root: build every part, hand each the few things it needs, and connect them
// through the session and the bus. No logic of its own beyond "when this happens, tell that".

import { api } from './core/api.js';
import { bus } from './core/bus.js';
import { connect } from './core/live.js';
import { navigate, onRoute, parse } from './core/router.js';
import { session } from './core/session.js';
import { settings } from './core/settings.js';
import { createCanvas } from './canvas/canvas.js';
import { createChat } from './panels/chat.js';
import { createInspector } from './panels/inspector.js';
import { createLayers } from './panels/layers.js';
import { createHistory } from './panels/history.js';
import { createSettingsMenu } from './panels/settings-menu.js';
import { createSplit } from './panels/split.js';
import { createSidebar } from './panels/sidebar.js';
import { createFinder } from './panels/finder.js';
import { createPlayer, flowStart } from './panels/player.js';
import { along, installShortcuts } from './panels/shortcuts.js';
import { createZoombar } from './panels/zoombar.js';
import { createTooltips } from './panels/tooltip.js';

const $ = (id) => document.getElementById(id);
api.version().then((v) => ($('version').textContent = `v${v}`), () => {});
const { state } = session;
let detailClosed = false;
let commenting = false; // comment mode: a click on a screen leaves a note
let drawnLines = settings.get().lines; // arrows are only re-routed when this one setting changes

// ---- parts -----------------------------------------------------------------------------------------
const canvas = createCanvas(
  { view: $('view'), world: $('world'), arrows: $('arrows') },
  {
    project: () => state.project,
    rev: () => state.rev,
    animated: settings.animated,
    lineStyle: settings.lineStyle,
    arrowMode: settings.arrowMode,
    onView: (view) => zoombar.show(view),
    onNote: (note) => api.command('add_note', { project: state.project, page: state.pageId, ...note }).then(() => session.loadNotes()),
    onNoteReply: (id, text) => api.command('reply_note', { project: state.project, id, text }).then(() => session.loadNotes()),
    onNoteRemove: (id) => api.command('resolve_note', { project: state.project, id }).then(() => session.loadNotes()),
    onProblems: (list) => zoombar.problems(list),
    onPick: (sel) => session.select(sel, { quiet: true }),
    // A table row that links somewhere ("flows/6_entry") opens that item on that page.
    onOpen: (link) => {
      const [page, id] = link.split('/');
      navigate({ project: state.project, page, id });
    },
  },
);

const zoombar = createZoombar({ warn: $('arrow-warn'), arrows: $('arrows-mode'), comment: $('comment-mode'), vis: $('comments-vis'), out: $('zoom-out'), in: $('zoom-in'), pct: $('zoom-pct'), fit: $('zoom-fit') }, canvas, settings, {
  onPick: (sel) => session.select(sel),
  onComment: () => ((commenting = !commenting), paintNotes()),
});
const chat = createChat(
  { button: $('chat-btn'), panel: $('chat') },
  { send: (text) => api.command('send_chat', { project: state.project, text, page: state.pageId, selected: state.sel?.kind === 'item' ? state.sel.id : undefined }).then(() => session.loadChat()) },
);
const sidebar = createSidebar(
  { app: $('app'), side: $('side'), pages: $('pages'), pagesBox: $('pages-box'), pagesToggle: $('pages-toggle'), pagesCount: $('pages-count'), projects: $('projects'), menu: $('menu'), close: $('side-close') },
  { onNavigate: (route) => navigate(route) },
);
createSplit({ side: $('side'), bar: $('split'), pagesBox: $('pages-box'), layersToggle: $('layers-toggle') });
const layers = createLayers({ box: $('layers-box'), list: $('layers'), search: $('search'), toggleAll: $('layers-all') }, { onPick: (sel) => session.select(sel) });
const inspector = createInspector($('inspector'), {
  page: () => state.page,
  pageId: () => state.pageId,
  project: () => state.project,
  components: () => state.components,
  onOpen: (page, id) => navigate({ project: state.project, page, id }),
  onPick: (sel) => session.select(sel),
  onPlay: (id) => player.play(id),
  onClose: () => {
    detailClosed = true; // only the panel goes; what is selected stays focused
    inspector.hide();
    canvas.closeDetail();
  },
});
createHistory({ button: $('history-btn'), panel: $('history') }, { project: () => state.project, list: (project) => api.command('history', { project }), restore: (project, n) => api.command('restore', { project, n }) });
createSettingsMenu({ button: $('settings-btn'), panel: $('settings') }, settings);
createTooltips(document.querySelectorAll('.zoombar')); // every floating tool island, now and beside the zoom bar later
// the canvas follows the prototype: when playing stops, the last screen played is selected
const player = createPlayer({ project: () => state.project, page: () => state.page, pageId: () => state.pageId, rev: () => state.rev, onExit: (id) => id && state.page?.items.some((i) => i.id === id) && session.select({ kind: 'item', id }) });
const finder = createFinder({ project: () => state.project, pages: () => state.info?.pages ?? [], onGo: (page, id) => navigate({ project: state.project, page, id }) });
installShortcuts({
  canvas,
  toggleSidebar: () => sidebar.toggle(),
  clearSelection: () => session.select(null),
  enabled: () => !!state.page,
  play: () => {
    const it = state.sel?.kind === 'item' ? state.page.items.find((i) => i.id === state.sel.id) : null;
    player.play(it?.type === 'frame' ? it.id : it?.type === 'group' ? flowStart(state.page, it.id) ?? undefined : undefined);
  },
  find: () => finder.open(),
  walk: (dir) => {
    const id = along(state.page, state.sel, dir);
    if (id) session.select({ kind: 'item', id });
  },
});

// What is happening to the open comments, said plainly so none is ever left looking stuck: the agent has
// them (a watcher is alive), the agent asked something, or nobody is listening.
let watching = false;
function paintStatus(list = state.notes.filter((n) => n.page === state.pageId)) {
  const el = $('agent-status');
  const asked = list.filter((n) => n.question).length;
  const working = list.length - asked;
  el.hidden = !list.length;
  if (!list.length) return;
  el.dataset.state = asked ? 'ask' : watching ? 'work' : 'idle';
  el.textContent = asked
    ? `The agent asked ${asked > 1 ? asked + ' questions' : 'a question'} · click the amber pin`
    : watching
      ? `Sent to the agent · ${working} comment${working > 1 ? 's' : ''} in progress`
      : 'Nobody is watching for comments · ask the agent, or run: npx framery watch';
}
const beat = async () => {
  const now = await api.watching();
  if (now !== watching) ((watching = now), paintStatus(), chat.show(state.chat, watching));
};
beat(); // not after the first note or message: that would say nobody is watching for a few seconds
setInterval(beat, 4000);
bus.on('chat', (messages) => chat.show(messages, watching));

// Comments on this page: shown when the person wants them or is writing one.
function paintNotes() {
  const list = state.notes.filter((n) => n.page === state.pageId);
  canvas.setNotes({ list, visible: commenting || settings.get().comments === 'show', commenting });
  zoombar.commenting(commenting);
  zoombar.count(list.length);
  paintStatus(list);
}
addEventListener('keydown', (event) => event.key === 'Escape' && commenting && ((commenting = false), paintNotes()));
bus.on('notes', paintNotes);
bus.on('settings', paintNotes);

// The address names a frame: a component is addressed by the frame it sits in.
const onCanvas = (sel) => (sel?.kind === 'component' ? { kind: 'item', id: sel.frame } : sel);

// ---- what happens when ----------------------------------------------------------------------------
const say = (text) => {
  $('empty').hidden = !text;
  $('empty').textContent = text ?? '';
};

bus.on('project', (event) => {
  if (!event) return say('No project found. Run framery init, or pass --data.');
  sidebar.show(event);
  document.title = `${event.info.title ?? event.name} · Framery`;
});

bus.on('page', ({ page, fresh }) => {
  say(page.items.length ? null : 'This page is empty. Ask an agent to add frames, or run: framery cmd add_item');
  layers.show(page, `${state.project}.${state.pageId}`);
  layers.setComponents(state.components);
  canvas.show(page, { fresh, viewKey: `${state.project}.${state.pageId}` });
  paintNotes();
  canvas.select(state.sel);
  layers.select(state.sel);
  if (state.sel && !detailClosed) inspector.show(state.sel);
  else (inspector.hide(), detailClosed && canvas.closeDetail());
});

bus.on('select', ({ sel, focus }) => {
  detailClosed = false;
  const picked = sel?.kind === 'item' ? session.item(sel.id) : null;
  chat.setContext(picked ? [picked.step, picked.title ?? picked.id].filter(Boolean).join(' ') : '');
  canvas.select(sel, { focus });
  layers.select(sel);
  if (sel && state.page) inspector.show(sel);
  else inspector.hide();
  if (state.page) navigate({ project: state.project, page: state.pageId, id: onCanvas(sel)?.kind === 'item' ? onCanvas(sel).id : null }, { replace: true });
});

bus.on('cache', () => canvas.cacheChanged());
bus.on('components', (list) => {
  layers.setComponents(list);
  if (state.sel && state.page && !detailClosed) inspector.show(state.sel);
});
bus.on('settings', (next) => next.lines !== drawnLines && ((drawnLines = next.lines), canvas.restyleArrows()));
bus.on('settings', () => canvas.syncArrows());
bus.on('frames', (paths) => canvas.framesChanged(paths));

// ---- go --------------------------------------------------------------------------------------------
async function go(route) {
  try {
    await session.open(route);
    sidebar.current(state.pageId);
    if (state.page) sidebar.closeDrawer();
  } catch (error) {
    say(`Could not open this: ${error.message}`);
  }
}

onRoute(go);
connect((events) => session.changed(events).catch((error) => console.error(error)));
go(parse());
