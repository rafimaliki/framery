// The left rail: project switcher and the pages. Page order and titles come from project.json. On a
// wide screen it folds to a strip of icons; on a small screen it is a drawer.

import { h, icon } from '../core/dom.js';

const SMALL = matchMedia('(max-width: 820px)');
const KEY = 'framery.sidebar';

// On a wide screen the rail folds to an icon strip to give the canvas room; on a small one it is a
// drawer over the canvas. One button each way, so the header's button does whichever applies.
export function createSidebar({ app, side, pages, projects, menu, close }, { onNavigate }) {
  menu.innerHTML = icon.menu;
  close.innerHTML = icon.sidebar;
  const read = () => {
    try {
      return localStorage.getItem(KEY) === 'collapsed';
    } catch {
      return false;
    }
  };
  let collapsed = read();

  function paint() {
    const hidden = SMALL.matches ? app.dataset.menu !== 'open' : collapsed;
    if (collapsed && !SMALL.matches) app.dataset.side = 'collapsed';
    else delete app.dataset.side;
    // The collapsed rail on a wide screen is still in use; only a hidden drawer is switched off.
    side.inert = SMALL.matches && hidden;
    menu.setAttribute('aria-expanded', String(!hidden));
    const label = SMALL.matches ? 'Close menu' : collapsed ? 'Show sidebar' : 'Hide sidebar';
    close.setAttribute('aria-label', label);
    close.title = SMALL.matches ? label : `${label} ( [ )`;
  }
  function setCollapsed(next) {
    collapsed = next;
    try {
      localStorage.setItem(KEY, next ? 'collapsed' : 'open');
    } catch {
      // not remembered, nothing lost
    }
    paint();
  }
  const setDrawer = (open) => {
    if (open) app.dataset.menu = 'open';
    else delete app.dataset.menu;
    paint();
  };
  menu.addEventListener('click', () => (SMALL.matches ? setDrawer(true) : setCollapsed(false)));
  close.addEventListener('click', () => (SMALL.matches ? setDrawer(false) : setCollapsed(!collapsed)));
  SMALL.addEventListener('change', paint);
  paint();

  function link(project, id, title, glyph) {
    const go = () => {
      setDrawer(false);
      onNavigate({ project, page: id });
    };
    return h('button', { class: 'page-link', type: 'button', 'data-page': id, title, 'aria-label': title, onclick: go }, h('span', { html: glyph }), h('span', { class: 'page-link__text' }, title));
  }

  return {
    // The project changed (or loaded): rebuild the switcher and the page list.
    show({ name, info, projects: all }) {
      projects.hidden = all.length < 2;
      projects.replaceChildren(...all.map((p) => h('option', { value: p.name, selected: p.name === name }, p.title ?? p.name)));
      projects.onchange = () => onNavigate({ project: projects.value });
      pages.replaceChildren(...(info.pages ?? []).map((p) => link(name, p.id, p.title, icon.page)));
    },

    current(pageId) {
      for (const button of pages.children) {
        if (button.dataset.page === pageId) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      }
    },

    closeDrawer: () => SMALL.matches && setDrawer(false),
    toggle: () => (SMALL.matches ? setDrawer(app.dataset.menu !== 'open') : setCollapsed(!collapsed)),
  };
}
