// The canvas as one object. It wires the camera, the world layer, the arrow layer and the anchor
// cache together and exposes the few things the rest of the studio needs: show a page, select,
// focus, zoom. Everything it tells the outside goes through the callbacks it is given.

import { createAnchors } from './anchors.js';
import { createArrows } from './arrows.js';
import { checkArrows, flagged } from './check.js';
import { createOutline } from './outline.js';
import { renderers } from './renderers/index.js';
import { createViewport } from './viewport.js';
import { createWorld } from './world.js';

const INSPECTOR = 360; // the width an open inspector covers, on a screen wide enough to dock it
const DOCK_MIN = 820;

const isFrameRef = (ref) => ref.includes('#');

function bounds(items) {
  const top = items.filter((item) => !item.parent);
  if (!top.length) return { x: 0, y: 0, w: 900, h: 600 };
  const x0 = Math.min(...top.map((i) => i.x));
  const y0 = Math.min(...top.map((i) => i.y));
  return { x: x0, y: y0, w: Math.max(...top.map((i) => i.x + i.w)) - x0, h: Math.max(...top.map((i) => i.y + i.h)) - y0 };
}

export function createCanvas({ view: viewEl, world: worldEl, arrows: svg }, deps) {
  let page = null;
  let key = null;
  let inspectorOpen = false;
  let frameRev = 0;
  let selectedComponent = null; // outlined now; redrawn when a re-render moves things under it
  let inFrame = null; // the frame that is selected, or holds the selected component: a click inside it goes deeper

  const ctx = { project: deps.project, rev: deps.rev, frameRev: () => frameRev };
  const world = createWorld(worldEl, renderers, ctx);
  const arrows = createArrows(svg, { animated: deps.animated, lineStyle: deps.lineStyle });
  const anchors = createAnchors({ project: deps.project, rev: deps.rev });
  const outline = createOutline(worldEl);
  // A live page is the truth about where its controls are: read from it when one is showing, from the
  // measured cache (which matches the picture) otherwise. Boxes are in frame pixels, as the page draws them.
  const liveDoc = (frameId) => {
    const doc = worldEl.querySelector(`.fr[data-id="${frameId}"] iframe`)?.contentDocument;
    return doc?.readyState === 'complete' ? doc : null;
  };
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  };
  const boxOf = (id, name) => {
    const el = liveDoc(id)?.querySelector(`[data-anchor="${CSS.escape(name)}"],[id="${CSS.escape(name)}"]`);
    return el && (el.offsetWidth || el.offsetHeight) ? rectOf(el) : anchors.box(id, name);
  };

  const viewport = createViewport(viewEl, worldEl, {
    animated: deps.animated,
    onChange(view) {
      const size = viewport.size();
      world.sync(view, size, false);
      arrows.draw(view, size);
      deps.onView(view);
    },
    onSettle(view) {
      world.sync(view, viewport.size(), true);
      if (key) save(view);
    },
    onTap: ({ target, x, y }) => {
      const link = target.closest?.('[data-link]'); // a table row's name opens what it links to
      if (link) return deps.onOpen(link.dataset.link);
      const picked = pick(target);
      // Inside the frame that is already selected, a click picks the component under it, if any.
      deps.onPick((picked?.kind === 'item' && picked.id === inFrame && componentAt(picked.id, viewport.toWorld(x, y))) || picked);
    },
    onDoubleTap: ({ target }) => {
      const picked = pick(target);
      if (picked?.kind === 'item') focus(picked.id, { zoom: true });
    },
  });

  // ---- remembering where you were ------------------------------------------------------------------
  const save = (view) => {
    try {
      localStorage.setItem(`framery.view.${key}`, JSON.stringify(view));
    } catch {
      // not remembered, nothing lost
    }
  };
  const saved = () => {
    try {
      const view = JSON.parse(localStorage.getItem(`framery.view.${key}`) ?? 'null');
      return view && [view.x, view.y, view.s].every(Number.isFinite) ? view : null;
    } catch {
      return null;
    }
  };

  function pick(target) {
    const arrow = target.closest?.('[data-arrow]');
    if (arrow) return { kind: 'arrow', id: arrow.dataset.arrow };
    const item = target.closest?.('.it');
    return item ? { kind: 'item', id: item.dataset.id } : null;
  }

  // The component instance under a world point inside a frame: the smallest box that holds it.
  function componentAt(frameId, point) {
    const frame = page?.items.find((i) => i.id === frameId);
    if (!frame || frame.type !== 'frame') return null;
    const inside = anchors
      .parts(frameId)
      .filter(({ box: [bx, by, bw, bh] }) => point.x >= frame.x + bx && point.x <= frame.x + bx + bw && point.y >= frame.y + by && point.y <= frame.y + by + bh)
      .sort((a, b) => a.box[2] * a.box[3] - b.box[2] * b.box[3])[0];
    return inside ? { kind: 'component', id: inside.component, frame: frameId, at: inside.at } : null;
  }

  // a live page that finishes loading moves the outline and the arrow ends onto the real controls
  worldEl.addEventListener('load', (e) => {
    const doc = e.target.tagName === 'IFRAME' ? e.target.contentDocument : null;
    if (!doc) return;
    const settle = () => {
      if (!page) return;
      if (selectedComponent) showComponent(selectedComponent, false);
      reroute();
      redraw();
    };
    settle();
    doc.fonts.ready.then(() => requestAnimationFrame(settle)); // fonts can still move the layout after load
  }, true);

  // Outline a component's instances in its frame (one instance when the click named it) and, when asked, show them.
  function showComponent(sel, flyTo) {
    const frame = page?.items.find((i) => i.id === sel.frame);
    if (!frame) return outline.clear();
    anchors.ensure([frame.id], () => draw());
    const draw = () => {
      const doc = liveDoc(frame.id);
      const live = doc && [...doc.querySelectorAll(`[data-fr-component="${sel.id}"]`)].map((el, at) => ({ at, box: rectOf(el) }));
      const parts = (live?.length ? live : anchors.parts(frame.id, sel.id)).filter((p) => sel.at == null || p.at === sel.at);
      const rects = parts.map(({ box: [x, y, w, h] }) => ({ x: frame.x + x, y: frame.y + y, w, h }));
      outline.show(rects);
      if (flyTo && rects.length) viewport.glide(viewport.fit(bounds(rects.map((r) => ({ ...r, parent: null }))), { pad: 160, max: 1, right: right() }));
    };
    draw();
  }

  const right = () => (inspectorOpen && viewport.size().w > DOCK_MIN ? INSPECTOR : 0);

  function focus(id, { zoom = false } = {}) {
    const item = page?.items.find((i) => i.id === id);
    if (!item) return;
    viewport.glide(viewport.fit(item, { pad: 110, max: zoom ? 1.4 : 1, right: right() }));
  }

  function focusArrow(id) {
    const arrow = page?.arrows.find((a) => a.id === id);
    if (!arrow) return;
    const ends = [arrow.from, arrow.to].map((ref) => page.items.find((i) => i.id === ref.split('#')[0])).filter(Boolean);
    if (!ends.length) return;
    const box = bounds(ends.map((i) => ({ ...i, parent: null })));
    viewport.glide(viewport.fit(box, { pad: 120, max: 1, right: right() }));
  }

  // The arrows with an end on this frame, or on anything inside this group.
  function arrowsOf(id) {
    const ids = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const i of page.items) if (i.parent && ids.has(i.parent) && !ids.has(i.id)) ids.add(i.id), (grew = true);
    }
    return new Set(page.arrows.filter((a) => ids.has(a.from.split('#')[0]) || ids.has(a.to.split('#')[0])).map((a) => a.id));
  }

  // Which arrows show: the mode, with focus mode falling back to all when nothing is focused.
  function syncArrows() {
    const mode = deps.arrowMode();
    const only = mode === 'none' ? new Set() : mode === 'focus' && inFrame && page ? arrowsOf(inFrame) : null;
    arrows.only(only);
    // a flowchart node goes with its arrows: hidden when it has some and none show (a lone node stays)
    const hidden = new Set();
    if (only && page) {
      const ends = (a, id) => a.from.split('#')[0] === id || a.to.split('#')[0] === id;
      for (const i of page.items) {
        const mine = i.type === 'node' ? page.arrows.filter((a) => ends(a, i.id)) : [];
        if (mine.length && !mine.some((a) => only.has(a.id))) hidden.add(i.id);
      }
    }
    world.hide(hidden);
    if (page) redraw();
  }

  // Route the arrows again and check them: the ones that cross, overlap or cut through an item are marked.
  function reroute() {
    arrows.setData(page.items, page.arrows, boxOf);
    const problems = checkArrows(page.items, page.arrows, boxOf, deps.lineStyle());
    arrows.warn(flagged(problems));
    deps.onProblems?.(problems);
  }

  function redraw() {
    viewport.set(viewport.get());
  }

  function loadAnchors() {
    const wanted = page.arrows.flatMap((a) => [a.from, a.to]).filter(isFrameRef).map((ref) => ref.split('#')[0]);
    anchors.ensure(wanted, () => {
      reroute();
      redraw();
    });
  }

  return {
    // Show a page. `fresh` is a page being opened; otherwise the same page was edited on disk, and
    // the camera stays where it is.
    show(next, { fresh, viewKey }) {
      page = next;
      if (fresh) {
        key = viewKey;
        world.clear();
      }
      world.setItems(page.items);
      reroute();
      syncArrows();
      loadAnchors();
      if (fresh) {
        viewport.set(saved() ?? viewport.fit(bounds(page.items), { pad: 70, max: 0.9 }));
        world.enter();
        arrows.playIn();
      } else redraw();
    },

    clear() {
      page = null;
      world.clear();
      arrows.setData([], [], boxOf);
      deps.onProblems?.([]);
    },

    select(sel, { focus: shouldFocus = false } = {}) {
      inspectorOpen = !!sel;
      inFrame = sel?.kind === 'item' ? sel.id : sel?.kind === 'component' ? sel.frame : null;
      // a component is outlined itself; its frame is not highlighted
      world.select(sel?.kind === 'item' ? sel.id : null);
      arrows.select(sel?.kind === 'arrow' ? sel.id : null);
      syncArrows();
      selectedComponent = sel?.kind === 'component' ? sel : null;
      if (sel?.kind === 'component') showComponent(sel, shouldFocus);
      else {
        outline.clear();
        if (inFrame) anchors.ensure([inFrame], () => {}); // so a click inside it can find a component
      }
      if (!shouldFocus || !sel || sel.kind === 'component') return;
      if (sel.kind === 'item') focus(sel.id);
      else focusArrow(sel.id);
    },

    // The detail panel was closed: the selection stays, the camera no longer leaves room for the panel.
    syncArrows,
    closeDetail: () => (inspectorOpen = false),
    focus,
    fitAll: () => page && viewport.glide(viewport.fit(bounds(page.items), { pad: 70, max: 0.9 })),
    zoomBy: (factor) => viewport.zoomBy(factor),
    zoomTo: (s) => viewport.zoomTo(s),
    pan: (dx, dy) => viewport.pan(dx, dy),

    // Previews were re-rendered: pictures and measured anchors are both new.
    // Arrows are routed again in the style the person chose.
    restyleArrows() {
      arrows.restyle();
      if (page) reroute();
      redraw();
    },

    cacheChanged() {
      world.refreshImages();
      anchors.forget();
      if (page) loadAnchors();
      // the boxes were measured again: an outline drawn from the old ones would sit where the component was
      if (selectedComponent) showComponent(selectedComponent, false);
    },

    // A frame's html or the project's css/js changed on disk.
    framesChanged(paths) {
      frameRev = Date.now();
      world.reload(paths);
    },
  };
}
