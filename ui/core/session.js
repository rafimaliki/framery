// What the studio is looking at: the open project, page and selection. It loads data through api,
// reacts to what changed on disk, and announces every change on the bus. It knows nothing about the
// DOM; panels and the canvas subscribe.

import { api } from './api.js';
import { bus } from './bus.js';

const state = { projects: [], project: null, info: null, pageId: null, page: null, sel: null, rev: 0, components: [] };

const itemOf = (page, id) => page?.items.find((item) => item.id === id);
const arrowOf = (page, id) => page?.arrows.find((arrow) => arrow.id === id);

function exists(sel) {
  if (!sel) return false;
  if (sel.kind === 'component') return !!itemOf(state.page, sel.frame);
  return sel.kind === 'arrow' ? !!arrowOf(state.page, sel.id) : !!itemOf(state.page, sel.id);
}

// The component library and where each is used; it changes when a definition or a frame does.
async function loadComponents() {
  state.components = await api.components(state.project);
  bus.emit('components', state.components);
}

async function loadPage() {
  state.page = await api.page(state.project, state.pageId);
  bus.emit('page', { page: state.page, fresh: false });
}

export const session = {
  state,

  item: (id) => itemOf(state.page, id),
  arrow: (id) => arrowOf(state.page, id),

  async open({ project, page, id }) {
    if (!state.projects.length) state.projects = await api.projects();
    const names = state.projects.map((p) => p.name);
    if (!names.length) {
      bus.emit('project', null);
      return;
    }
    const name = names.includes(project) ? project : names[0];
    if (name !== state.project) {
      state.project = name;
      state.info = await api.project(name);
      state.rev = 0;
      bus.emit('project', { name, info: state.info, projects: state.projects });
      loadComponents();
    }
    const pages = state.info.pages ?? [];
    const wanted = pages.some((p) => p.id === page) ? page : pages[0]?.id;
    const switched = wanted !== state.pageId;
    state.pageId = wanted;
    if (switched) state.sel = null;
    if (switched || !state.page) {
      state.page = await api.page(name, wanted);
      bus.emit('page', { page: state.page, fresh: true });
    }
    session.select(id && itemOf(state.page, id) ? { kind: 'item', id } : null, { quiet: !id });
  },

  select(sel, { quiet = false } = {}) {
    if (!state.sel && !sel) return;
    state.sel = sel;
    bus.emit('select', { sel, focus: !quiet && !!sel });
  },

  // Called with what the server saw change. Only the open project is reloaded.
  async changed(events) {
    const mine = events.filter((e) => e.project === state.project);
    if (!mine.length) return;
    if (mine.some((e) => e.type === 'project')) {
      state.projects = await api.projects();
      state.info = await api.project(state.project);
      bus.emit('project', { name: state.project, info: state.info, projects: state.projects });
    }
    if (mine.some((e) => e.type === 'page' && e.page === state.pageId)) {
      await loadPage();
      if (!exists(state.sel)) session.select(null);
    }
    if (mine.some((e) => e.type === 'history')) bus.emit('history');
    if (mine.some((e) => e.type === 'cache')) {
      state.rev = Date.now();
      bus.emit('cache', state.rev);
    }
    if (mine.some((e) => e.type === 'library' || e.type === 'frame')) await loadComponents();
    const frames = mine.filter((e) => e.type === 'frame' || e.type === 'assets');
    if (frames.length) bus.emit('frames', frames.some((e) => e.type === 'assets') ? null : frames.map((e) => e.path));
  },
};
