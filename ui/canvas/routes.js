// How an arrow travels between its two ends, in screen pixels. Three routers share one contract, so a
// new style is one function and one table entry:
//
//   router(p0, n0, p1, n1, head) -> { points, end, dir }
//     p0, p1  the source point and the target point
//     n0, n1  the outward normals of the sides they sit on (the arrow leaves along n0, enters against n1)
//     points  the polyline or curve control points the path follows, from p0 to the end of the line
//     end     where the line stops (just short of p1, so the head sits on the edge)
//     dir     the unit vector the head points along
//
// route() turns that into an SVG path, a head polygon, a label position and a bounding box.

const MAX_STUB = 20; // how far an elbow leaves a side before it may turn, when there is room
const ROUND = 10; // corner radius of an elbow
const TINY = 48; // closer than this (zoomed far out) an elbow has no room to turn and is just a line
const f = (n) => n.toFixed(1);
const unit = (a, b) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
};

// ---- the three routers -----------------------------------------------------------------------------
function straight(p0, _n0, p1, _n1, head) {
  const dir = unit(p0, p1);
  const end = [p1[0] - dir[0] * head, p1[1] - dir[1] * head];
  return { kind: 'line', points: [p0, end], end, dir };
}

function curved(p0, n0, p1, n1, head) {
  const end = [p1[0] + n1[0] * head, p1[1] + n1[1] * head];
  const pull = Math.min(240, Math.hypot(end[0] - p0[0], end[1] - p0[1]) * 0.42);
  const c0 = [p0[0] + n0[0] * pull, p0[1] + n0[1] * pull];
  const c1 = [end[0] + n1[0] * pull, end[1] + n1[1] * pull];
  return { kind: 'bezier', points: [p0, c0, c1, end], end, dir: [-n1[0], -n1[1]] };
}

// Straight segments that turn at right angles: leave the side, turn, run, turn, arrive square-on.
function elbow(p0, n0, p1, n1, head, via = {}) {
  // The turn distance shrinks with the arrow, so a zoomed-out arrow keeps its shape instead of looping.
  const STUB = Math.max(4, Math.min(MAX_STUB, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * 0.25));
  const end = [p1[0] + n1[0] * head, p1[1] + n1[1] * head];
  const h0 = n0[0] !== 0;
  const h1 = n1[0] !== 0;
  const a = [p0[0] + n0[0] * STUB, p0[1] + n0[1] * STUB];
  const b = [p1[0] + n1[0] * STUB, p1[1] + n1[1] * STUB];
  let points;

  if (h0 && h1) {
    const opposed = n0[0] === -n1[0];
    const forward = n0[0] * (p1[0] - p0[0]) > STUB * 2;
    if (opposed && forward) {
      const x = lane(via.x, p0[0], p1[0], n0[0], STUB) ?? (p0[0] + p1[0]) / 2;
      points = [p0, [x, p0[1]], [x, p1[1]], end];
    } else if (!opposed) {
      const x = n0[0] > 0 ? Math.max(p0[0], p1[0]) + STUB : Math.min(p0[0], p1[0]) - STUB;
      points = [p0, [x, p0[1]], [x, p1[1]], end];
    } else {
      const y = Math.abs(p0[1] - p1[1]) < STUB * 2 ? Math.min(p0[1], p1[1]) - STUB * 1.5 : (p0[1] + p1[1]) / 2;
      points = [p0, a, [a[0], y], [b[0], y], b, end];
    }
  } else if (!h0 && !h1) {
    const opposed = n0[1] === -n1[1];
    const forward = n0[1] * (p1[1] - p0[1]) > STUB * 2;
    if (opposed && forward) {
      const y = lane(via.y, p0[1], p1[1], n0[1], STUB) ?? (p0[1] + p1[1]) / 2;
      points = [p0, [p0[0], y], [p1[0], y], end];
    } else if (!opposed) {
      const y = n0[1] > 0 ? Math.max(p0[1], p1[1]) + STUB : Math.min(p0[1], p1[1]) - STUB;
      points = [p0, [p0[0], y], [p1[0], y], end];
    } else {
      const x = Math.abs(p0[0] - p1[0]) < STUB * 2 ? Math.min(p0[0], p1[0]) - STUB * 1.5 : (p0[0] + p1[0]) / 2;
      points = [p0, a, [x, a[1]], [x, b[1]], b, end];
    }
  } else if (h0) {
    // leaves sideways, arrives from above or below: one corner when it is in front of both
    const corner = [p1[0], p0[1]];
    const ok = n0[0] * (p1[0] - p0[0]) > STUB * 0.5 && n1[1] * (p0[1] - p1[1]) > STUB * 0.5;
    points = ok ? [p0, corner, end] : [p0, a, [a[0], b[1]], b, end];
  } else {
    const corner = [p0[0], p1[1]];
    const ok = n0[1] * (p1[1] - p0[1]) > STUB * 0.5 && n1[0] * (p0[0] - p1[0]) > STUB * 0.5;
    points = ok ? [p0, corner, end] : [p0, a, [b[0], a[1]], b, end];
  }
  return { kind: 'poly', points: points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]), end, dir: [-n1[0], -n1[1]] };
}

// The preferred lane for the middle run (screen px), used only if it lies clear of both stubs.
function lane(at, from, to, n, stub) {
  if (at == null) return null;
  return n * (at - from) > stub && n * (to - at) > stub ? at : null;
}

export const routers = { straight, curved, elbow };

// ---- turning a route into drawing ------------------------------------------------------------------
function rounded(points) {
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [p, c, n] = [points[i - 1], points[i], points[i + 1]];
    const r = Math.min(ROUND, Math.hypot(c[0] - p[0], c[1] - p[1]) / 2, Math.hypot(n[0] - c[0], n[1] - c[1]) / 2);
    const before = [c[0] - unit(p, c)[0] * r, c[1] - unit(p, c)[1] * r];
    const after = [c[0] + unit(c, n)[0] * r, c[1] + unit(c, n)[1] * r];
    d += `L${f(before[0])} ${f(before[1])}Q${f(c[0])} ${f(c[1])} ${f(after[0])} ${f(after[1])}`;
  }
  const last = points.at(-1);
  return `${d}L${f(last[0])} ${f(last[1])}`;
}

function middle(points) {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  let half = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (half <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? half / lengths[i] : 0;
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t];
    }
    half -= lengths[i];
  }
  return points[0];
}

export function route(style, p0, n0, p1, n1, via) {
  const span = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const head = Math.min(8, span * 0.35); // a short arrow keeps a proportionate head
  const pick = style === 'elbow' && span < TINY ? 'straight' : style;
  const { kind, points, end, dir } = (routers[pick] ?? routers.elbow)(p0, n0, p1, n1, head, via);
  const side = [-dir[1], dir[0]];
  const wing = head * 0.52;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  let d;
  let mid;
  if (kind === 'bezier') {
    const [a, b, c, e] = points;
    d = `M${f(a[0])} ${f(a[1])}C${f(b[0])} ${f(b[1])} ${f(c[0])} ${f(c[1])} ${f(e[0])} ${f(e[1])}`;
    mid = [(a[0] + 3 * b[0] + 3 * c[0] + e[0]) / 8, (a[1] + 3 * b[1] + 3 * c[1] + e[1]) / 8];
  } else if (kind === 'poly') {
    d = rounded(points);
    mid = middle(points);
  } else {
    d = `M${f(p0[0])} ${f(p0[1])}L${f(end[0])} ${f(end[1])}`;
    mid = middle(points);
  }
  return {
    d,
    head: `${f(p1[0])},${f(p1[1])} ${f(end[0] + side[0] * wing)},${f(end[1] + side[1] * wing)} ${f(end[0] - side[0] * wing)},${f(end[1] - side[1] * wing)}`,
    mid,
    box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
  };
}
