import { CAPTION_H } from './routes.js';

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

// How well a side of a box faces a point: 1 straight at it, -1 away. Sideways wins a tie by a hair.
function facing(rect, toward, side) {
  const [cx, cy] = centreOf(rect);
  const len = Math.hypot(toward[0] - cx, toward[1] - cy) || 1;
  return (NORMAL[side][0] * (toward[0] - cx) + NORMAL[side][1] * (toward[1] - cy)) / len + (NORMAL[side][0] ? 0.001 : 0);
}
const best = (sides, rect, toward) => sides.reduce((a, b) => (facing(rect, toward, b) > facing(rect, toward, a) ? b : a));

// How far a control sits from each edge of its frame.
const roomOf = (r, item) => ({ top: r.y - item.y, bottom: item.y + item.h - r.y - r.h, left: r.x - item.x, right: item.x + item.w - r.x - r.w });

// An arrow anchored to a control leaves from the control's own side, but when that side faces into the
// frame (a button at the bottom, the target above) the line would cross the whole screen. Then it leaves
// from a side the control sits close to instead, the one that faces the target best.
const NEAR_EDGE = 48;

// `rather`: a side to take when it faces the target as well as the best one does (see the pairs in resolve).
function exitSide(end, item, side, toward, rather) {
  if (!end.element) return side;
  const room = roomOf(end.rect, item);
  if (room[side] <= NEAR_EDGE) return side;
  const near = Object.keys(room).filter((s) => room[s] <= NEAR_EDGE);
  if (!near.length) return side;
  const top = best(near, end.rect, toward);
  return near.includes(rather) && facing(end.rect, toward, top) - facing(end.rect, toward, rather) < 0.01 ? rather : top;
}
const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

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
  // two items connected both ways: the second arrow leaves from the other side when it can, so the pair
  // draws a loop instead of two lines down one side
  const pairSide = new Map();
  const pair = (a, b) => [a, b].sort().join('|');
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
      from: { ...from, side: arrow.fromSide ?? exitSide(from, byId.get(from.id), auto0, centreOf(to.rect), OPPOSITE[pairSide.get(pair(from.id, to.id))]), other: centreOf(to.rect) },
      to: { ...to, side: arrow.toSide ?? exitSide(to, byId.get(to.id), auto1, centreOf(from.rect)), other: centreOf(from.rect) },
    });
    if (!pairSide.has(pair(from.id, to.id))) pairSide.set(pair(from.id, to.id), ends.at(-1).from.side);
  }

  // A diamond touches its box only at the middle of each side: an end sits on that point, never spread
  // along the side, and an arrow wanting a side another already has takes the free point that faces its
  // other end best ("yes" out the right, "no" out the bottom).
  const taken = new Map();
  for (const { arrow, from, to } of ends) {
    for (const [end, forced] of [[from, arrow.fromSide], [to, arrow.toSide]]) {
      if (end.element || byId.get(end.id)?.shape !== 'diamond') continue;
      if (!taken.has(end.id)) taken.set(end.id, new Set());
      const used = taken.get(end.id);
      const free = Object.keys(NORMAL).filter((s) => !used.has(s));
      if (!forced && used.has(end.side) && free.length) end.side = best(free, end.rect, end.other);
      used.add(end.side);
      end.point = true;
    }
  }

  // Arrows that share a side of the same box fan out along it instead of stacking, ordered by where
  // their other end lies so they do not cross each other needlessly.
  const shared = new Map();
  for (const entry of ends) {
    for (const end of [entry.from, entry.to]) {
      if (end.point) continue;
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

  return spread(
    ends.map(({ arrow, from, to }) => {
      const p0 = pointOn(from.rect, from.side, from.t);
      const p1 = pointOn(to.rect, to.side, to.t);
      const n0 = NORMAL[from.side];
      const n1 = NORMAL[to.side];
      // an anchored end's first run must clear its own frame, not stop just past the control
      const clear = (end) => (end.element ? Math.max(0, roomOf(end.rect, byId.get(end.id))[end.side]) : 0);
      // an end on the top of a captioned item turns above its caption (screen px, so not scaled)
      const cap = (end) => {
        const item = byId.get(end.id);
        return !end.element && end.side === 'top' && ['frame', 'group', 'table'].includes(item.type) && (item.title || item.step) ? CAPTION_H : 0;
      };
      return { id: arrow.id, label: arrow.label ?? '', tone: arrow.tone ?? 'neutral', p0, n0, p1, n1, anchored: from.element, via: { ...channel(items, p0, n0, p1, n1), clear0: clear(from), clear1: clear(to), cap0: cap(from), cap1: cap(to) } };
    }),
  );
}

// Do two segments meet? Parallel runs closer than NEAR that share a stretch count (they draw as one line);
// otherwise only a true crossing does, not a touch at an end.
const NEAR = 4;
export function meets([a, b], [c, d]) {
  for (const k of [0, 1]) {
    if (a[k] === b[k] && c[k] === d[k]) {
      const j = 1 - k;
      const overlap = Math.min(Math.max(a[j], b[j]), Math.max(c[j], d[j])) - Math.max(Math.min(a[j], b[j]), Math.min(c[j], d[j]));
      return Math.abs(a[k] - c[k]) < NEAR && overlap > 1;
    }
  }
  const side = (o, p, q) => Math.sign((p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]));
  return side(c, d, a) * side(c, d, b) < 0 && side(a, b, c) * side(a, b, d) < 0;
}

export const segments = (points) => points.slice(1).map((p, i) => [points[i], p]);

// Arrows whose middle runs land on the same lane would draw on top of each other: spread them across
// it, in the order that crosses least (tried in full for a few, by source position beyond that).
const LANE_STEP = 16;

function permutations(list) {
  if (list.length < 2) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest]));
}

function spread(routes) {
  for (const axis of ['x', 'y']) {
    const i = axis === 'x' ? 0 : 1;
    const model = (r, at) => (axis === 'x' ? [r.p0, [at, r.p0[1]], [at, r.p1[1]], r.p1] : [r.p0, [r.p0[0], at], [r.p1[0], at], r.p1]);
    const lanes = new Map();
    for (const r of routes) {
      if (r.via[axis] == null) continue;
      const k = Math.round(r.via[axis]);
      if (!lanes.has(k)) lanes.set(k, []);
      lanes.get(k).push(r);
    }
    for (const group of lanes.values()) {
      if (group.length < 2) continue;
      const centre = group[0].via[axis];
      const step = Math.min(LANE_STEP, Math.min(...group.map((r) => r.via.room)) / (group.length + 1));
      const at = (k) => centre + (k - (group.length - 1) / 2) * step;
      const cost = (order) => {
        const lines = order.map((r, k) => segments(model(r, at(k))));
        let n = 0;
        for (let a = 0; a < lines.length; a++) for (let b = a + 1; b < lines.length; b++) n += lines[a].filter((s) => lines[b].some((t) => meets(s, t))).length;
        return n;
      };
      const byStart = [...group].sort((a, b) => a.p0[1 - i] - b.p0[1 - i]);
      const order = group.length > 5 ? byStart : permutations(byStart).reduce((best, o) => (cost(o) < cost(best) ? o : best));
      order.forEach((r, k) => (r.via = { ...r.via, [axis]: at(k) }));
    }
  }
  return routes;
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
  const [x, y] = gaps.sort((u, v) => Math.abs((u[0] + u[1]) / 2 - mid) - Math.abs((v[0] + v[1]) / 2 - mid))[0];
  return { [axis]: (x + y) / 2, room: y - x };
}
