// The composition root: build every part, hand each the few things it needs, and connect them
// through the session and the bus. No logic of its own beyond "when this happens, tell that".

import { api } from './core/api.js';
import { bus } from './core/bus.js';
import { connect } from './core/live.js';
import { navigate, onRoute, parse } from './core/router.js';
import { session } from './core/session.js';
import { settings } from './core/settings.js';
import { createCanvas } from './canvas/canvas.js';
import { createInspector } from './panels/inspector.js';
import { createLayers } from './panels/layers.js';
import { createHistory } from './panels/history.js';
import { createSettingsMenu } from './panels/settings-menu.js';
import { createSidebar } from './panels/sidebar.js';
import { createFinder } from './panels/finder.js';
import { installShortcuts } from './panels/shortcuts.js';
import { createZoombar } from './panels/zoombar.js';

const $ = (id) => document.getElementById(id);
const { state } = session;
let detailClosed = false;
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
    onProblems: (list) => zoombar.problems(list),
    onPick: (sel) => session.select(sel, { quiet: true }),
    // A table row that links somewhere ("flows/6_entry") opens that item on that page.
    onOpen: (link) => {
      const [page, id] = link.split('/');
      navigate({ project: state.project, page, id });
    },
  },
);

const zoombar = createZoombar({ warn: $('arrow-warn'), arrows: $('arrows-mode'), out: $('zoom-out'), in: $('zoom-in'), pct: $('zoom-pct'), fit: $('zoom-fit') }, canvas, settings, { onPick: (sel) => session.select(sel) });
const sidebar = createSidebar(
  { app: $('app'), side: $('side'), pages: $('pages'), projects: $('projects'), menu: $('menu'), close: $('side-close') },
  { onNavigate: (route) => navigate(route) },
);
const layers = createLayers({ box: $('layers-box'), list: $('layers'), search: $('search'), toggleAll: $('layers-all') }, { onPick: (sel) => session.select(sel) });
const inspector = createInspector($('inspector'), {
  page: () => state.page,
  pageId: () => state.pageId,
  project: () => state.project,
  components: () => state.components,
  onOpen: (page, id) => navigate({ project: state.project, page, id }),
  onPick: (sel) => session.select(sel),
  onClose: () => {
    detailClosed = true; // only the panel goes; what is selected stays focused
    inspector.hide();
    canvas.closeDetail();
  },
});
createHistory({ button: $('history-btn'), panel: $('history') }, { project: () => state.project, list: (project) => api.command('history', { project }), restore: (project, n) => api.command('restore', { project, n }) });
createSettingsMenu({ button: $('settings-btn'), panel: $('settings') }, settings);
const finder = createFinder({ project: () => state.project, pages: () => state.info?.pages ?? [], onGo: (page, id) => navigate({ project: state.project, page, id }) });
installShortcuts({ canvas, toggleSidebar: () => sidebar.toggle(), clearSelection: () => session.select(null), enabled: () => !!state.page, find: () => finder.open() });

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
  canvas.select(state.sel);
  layers.select(state.sel);
  if (state.sel && !detailClosed) inspector.show(state.sel);
  else (inspector.hide(), detailClosed && canvas.closeDetail());
});

bus.on('select', ({ sel, focus }) => {
  detailClosed = false;
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
