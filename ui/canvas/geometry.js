// Pure arrow geometry in world units: which side an arrow leaves and enters, where along that side it
// sits when several share it, and the curve between. No DOM, no view, nothing to mock.

export const NORMAL = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };

const centreOf = (r) => [r.x + r.w / 2, r.y + r.h / 2];

export function autoSides(a, b) {
  if (b.x >= a.x + a.w) return ['right', 'left'];
  if (b.x + b.w <= a.x) return ['left', 'right'];
  if (b.y >= a.y + a.h) return ['bottom', 'top'];
  return ['top', 'bottom'];
}

export function pointOn(rect, side, t = 0.5) {
  if (side === 'top') return [rect.x + rect.w * t, rect.y];
  if (side === 'bottom') return [rect.x + rect.w * t, rect.y + rect.h];
  if (side === 'left') return [rect.x, rect.y + rect.h * t];
  return [rect.x + rect.w, rect.y + rect.h * t];
}

// The box an arrow end points at: an element inside a frame when its box is known, else the item.
function endRect(ref, itemsById, boxOf) {
  const [id, element] = ref.split('#');
  const item = itemsById.get(id);
  if (!item) return null;
  const box = element ? boxOf(id, element) : null;
  const rect = box ? { x: item.x + box[0], y: item.y + box[1], w: box[2], h: box[3] } : { x: item.x, y: item.y, w: item.w, h: item.h };
  return { id, rect, key: box ? ref : id, element: !!box };
}

// Is something standing in the way of a sideways arrow: a frame between the two ends, on the same band?
function blockedBetween(items, from, to) {
  const left = from.rect.x < to.rect.x ? from : to;
  const right = left === from ? to : from;
  const lo = Math.min(from.rect.y + from.rect.h / 2, to.rect.y + to.rect.h / 2);
  const hi = Math.max(from.rect.y + from.rect.h / 2, to.rect.y + to.rect.h / 2);
  return items.some(
    (i) =>
      ['frame', 'table'].includes(i.type) && i.id !== from.id && i.id !== to.id && i.x >= left.rect.x + left.rect.w - 1 && i.x + i.w <= right.rect.x + 1 && i.y < hi && i.y + i.h > lo,
  );
}

// One entry per drawable arrow: both ends as a point and an outward normal.
export function resolve(arrows, items, boxOf) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ends = [];
  for (const arrow of arrows) {
    const from = endRect(arrow.from, byId, boxOf);
    const to = endRect(arrow.to, byId, boxOf);
    if (!from || !to) continue;
    const [auto0, auto1Plain] = autoSides(from.rect, to.rect);
    let auto1 = auto1Plain;
    // A sideways arrow with frames in between would cut straight through them; when the target lies
    // above or below the source, come in from that side instead and run clear of the row.
    if (!arrow.toSide && (auto0 === 'right' || auto0 === 'left') && blockedBetween(items, from, to)) {
      const cy = from.rect.y + from.rect.h / 2;
      if (cy > to.rect.y + to.rect.h) auto1 = 'bottom';
      else if (cy < to.rect.y) auto1 = 'top';
    }
    ends.push({
      arrow,
      from: { ...from, side: arrow.fromSide ?? auto0, other: centreOf(to.rect) },
      to: { ...to, side: arrow.toSide ?? auto1, other: centreOf(from.rect) },
    });
  }

  // Arrows that share a side of the same box fan out along it instead of stacking, ordered by where
  // their other end lies so they do not cross each other needlessly.
  const shared = new Map();
  for (const entry of ends) {
    for (const end of [entry.from, entry.to]) {
      const k = `${end.key}|${end.side}`;
      if (!shared.has(k)) shared.set(k, []);
      shared.get(k).push(end);
    }
  }
  for (const group of shared.values()) {
    const along = (end) => (end.side === 'top' || end.side === 'bottom' ? end.other[0] : end.other[1]);
    group.sort((a, b) => along(a) - along(b));
    group.forEach((end, i) => {
      end.t = (i + 1) / (group.length + 1);
    });
  }

  return ends.map(({ arrow, from, to }) => {
    const p0 = pointOn(from.rect, from.side, from.t);
    const p1 = pointOn(to.rect, to.side, to.t);
    const n0 = NORMAL[from.side];
    const n1 = NORMAL[to.side];
    return { id: arrow.id, label: arrow.label ?? '', tone: arrow.tone ?? 'neutral', p0, n0, p1, n1, anchored: from.element, via: channel(items, p0, n0, p1, n1) };
  });
}

// The free lanes along one axis between lo and hi: spans no frame, table or node covers anywhere along
// the other axis' span. An elbow's long middle run goes down such a lane, between the frames, instead of
// through whichever frame happens to sit halfway.
const SOLID = new Set(['frame', 'table', 'node']);
const MARGIN = 24;

function lanes(items, axis, lo, hi, from, to) {
  const other = axis === 'x' ? 'y' : 'x';
  const size = axis === 'x' ? 'w' : 'h';
  const across = axis === 'x' ? 'h' : 'w';
  const covered = items
    .filter((i) => SOLID.has(i.type) && i[other] < to && i[other] + i[across] > from)
    .map((i) => [i[axis], i[axis] + i[size]])
    .sort((a, b) => a[0] - b[0]);
  const free = [];
  let cursor = lo;
  for (const [a, b] of covered) {
    if (b <= cursor) continue;
    if (a > cursor) free.push([cursor, Math.min(a, hi)]);
    cursor = Math.max(cursor, b);
    if (cursor >= hi) break;
  }
  if (cursor < hi) free.push([cursor, hi]);
  return free.filter(([a, b]) => b - a >= MARGIN * 2);
}

// Where the middle run of an elbow should sit, in world units: { x } for sideways arrows, { y } for
// vertical ones, or nothing when the ends are not facing each other or no lane fits.
export function channel(items, p0, n0, p1, n1) {
  const opposed = n0[0] === -n1[0] && n0[1] === -n1[1];
  if (!opposed) return {};
  const sideways = n0[0] !== 0;
  const axis = sideways ? 'x' : 'y';
  const i = sideways ? 0 : 1;
  const n = n0[i];
  if (n * (p1[i] - p0[i]) <= MARGIN * 2) return {};
  const a = p0[i] + n * MARGIN;
  const b = p1[i] - n * MARGIN;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const j = 1 - i;
  const gaps = lanes(items, axis, lo, hi, Math.min(p0[j], p1[j]), Math.max(p0[j], p1[j]));
  if (!gaps.length) return {};
  const mid = (p0[i] + p1[i]) / 2;
  const at = gaps.map(([x, y]) => (x + y) / 2).sort((u, v) => Math.abs(u - mid) - Math.abs(v - mid))[0];
  return { [axis]: at };
}
