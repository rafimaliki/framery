// The camera and its input. It turns wheel, drag, pinch and touch into one view {x, y, s} (screen =
// world * s + offset) and draws the dotted ground. It knows nothing about what sits on the canvas;
// it reports the view and taps, and the layers above decide what they mean.

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 4;
const SETTLE_MS = 140;
const TAP_SLOP = 5;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const ease = (t) => 1 - (1 - t) ** 3;

export function createViewport(el, world, { animated, onChange, onSettle, onTap, onDoubleTap }) {
  let view = { x: 0, y: 0, s: 1 };
  let frame = 0;
  let settleTimer = 0;
  let glideFrame = 0;
  const pointers = new Map();
  let gesture = null;

  const size = () => ({ w: el.clientWidth, h: el.clientHeight });

  function flush() {
    frame = 0;
    world.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})`;
    world.style.setProperty('--z', view.s);
    let step = 24 * view.s;
    while (step < 14) step *= 2;
    el.style.setProperty('--grid', `${step}px`);
    el.style.setProperty('--gx', `${view.x}px`);
    el.style.setProperty('--gy', `${view.y}px`);
    onChange(view);
  }

  function moved() {
    el.dataset.moving = 'true';
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      delete el.dataset.moving;
      onSettle(view);
    }, SETTLE_MS);
    if (!frame) frame = requestAnimationFrame(flush);
  }

  function set(next) {
    view = { x: next.x, y: next.y, s: clamp(next.s, MIN_SCALE, MAX_SCALE) };
    moved();
  }

  function zoomAt(factor, px, py) {
    const s = clamp(view.s * factor, MIN_SCALE, MAX_SCALE);
    const k = s / view.s;
    set({ x: px - (px - view.x) * k, y: py - (py - view.y) * k, s });
  }

  const centre = () => ({ x: size().w / 2, y: size().h / 2 });
  const local = (event) => {
    const box = el.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  function stopGlide() {
    cancelAnimationFrame(glideFrame);
    glideFrame = 0;
  }

  // Move the camera to a target view: instantly, or as an eased glide that keeps the same world point
  // under the middle of the screen so a zoom and a pan read as one movement.
  function glide(target, ms = 320) {
    stopGlide();
    const { w, h } = size();
    if (!animated() || !w) return set(target);
    const from = { cx: (w / 2 - view.x) / view.s, cy: (h / 2 - view.y) / view.s, s: view.s };
    const to = { cx: (w / 2 - target.x) / target.s, cy: (h / 2 - target.y) / target.s, s: clamp(target.s, MIN_SCALE, MAX_SCALE) };
    const started = performance.now();
    const tick = (now) => {
      const t = ease(Math.min(1, (now - started) / ms));
      const s = from.s * (to.s / from.s) ** t;
      set({ s, x: w / 2 - (from.cx + (to.cx - from.cx) * t) * s, y: h / 2 - (from.cy + (to.cy - from.cy) * t) * s });
      glideFrame = t < 1 ? requestAnimationFrame(tick) : 0;
    };
    glideFrame = requestAnimationFrame(tick);
  }

  // The view that shows a world rectangle, centred in what is left after `right` pixels of overlay,
  // no larger than 100% unless told otherwise.
  function fit(rect, { pad = 90, max = 1, right = 0 } = {}) {
    const { w, h } = size();
    const free = Math.max(120, w - right);
    const s = clamp(Math.min((free - pad * 2) / rect.w, (h - pad * 2) / rect.h), MIN_SCALE, Math.min(max, MAX_SCALE));
    return { s, x: free / 2 - (rect.x + rect.w / 2) * s, y: h / 2 - (rect.y + rect.h / 2) * s };
  }

  // ---- input ---------------------------------------------------------------------------------------
  el.addEventListener('wheel', (event) => {
    event.preventDefault();
    stopGlide();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size().h : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;
    if (event.ctrlKey || event.metaKey) {
      const at = local(event);
      zoomAt(Math.exp(-clamp(dy, -120, 120) * 0.0022), at.x, at.y);
    } else if (event.shiftKey && !dx) set({ ...view, x: view.x - dy });
    else set({ ...view, x: view.x - dx, y: view.y - dy });
  }, { passive: false });

  el.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button > 1) return;
    stopGlide();
    el.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, local(event));
    gesture = pointers.size === 1 ? { target: event.target, start: local(event), dragged: false, at: event.timeStamp } : { ...gesture, dragged: true };
    el.dataset.drag = 'true';
  });

  el.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    const now = local(event);
    const before = pointers.get(event.pointerId);
    if (pointers.size === 1) {
      if (!gesture.dragged && Math.hypot(now.x - gesture.start.x, now.y - gesture.start.y) < TAP_SLOP) return;
      gesture.dragged = true;
      set({ ...view, x: view.x + now.x - before.x, y: view.y + now.y - before.y });
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1];
      const oldMid = { x: (before.x + other.x) / 2, y: (before.y + other.y) / 2 };
      const newMid = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
      const factor = Math.hypot(now.x - other.x, now.y - other.y) / (Math.hypot(before.x - other.x, before.y - other.y) || 1);
      const s = clamp(view.s * factor, MIN_SCALE, MAX_SCALE);
      const k = s / view.s;
      set({ s, x: newMid.x - (oldMid.x - view.x) * k, y: newMid.y - (oldMid.y - view.y) * k });
    }
    pointers.set(event.pointerId, now);
  });

  const release = (event) => {
    if (!pointers.delete(event.pointerId)) return;
    if (!pointers.size) {
      delete el.dataset.drag;
      if (gesture && !gesture.dragged && event.type === 'pointerup') {
        const tap = { target: gesture.target, x: gesture.start.x, y: gesture.start.y, time: event.timeStamp };
        if (lastTap && tap.time - lastTap.time < 320 && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 14) {
          onDoubleTap(tap);
          lastTap = null;
        } else {
          onTap(tap);
          lastTap = tap;
        }
      }
      gesture = null;
    }
  };
  let lastTap = null;
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);

  new ResizeObserver(moved).observe(el);

  return {
    get: () => view,
    size,
    set,
    glide,
    fit,
    zoomBy: (factor) => zoomAt(factor, centre().x, centre().y),
    zoomTo: (s) => zoomAt(s / view.s, centre().x, centre().y),
    toWorld: (px, py) => ({ x: (px - view.x) / view.s, y: (py - view.y) / view.s }),
    pan: (dx, dy) => set({ ...view, x: view.x + dx, y: view.y + dy }),
  };
}
