// What the studio would draw badly: arrows that cross or run along each other, arrows that cut through
// a frame, table or node, and labels that cover an item or each other. It routes with the studio's own
// code (ui/canvas) at 1:1, the zoom a person reads labels at, so a page that passes here draws clean there.

import { meets, resolve, segments } from '../ui/canvas/geometry.js';
import { PILL_H, labelAt, pillWidth, route } from '../ui/canvas/routes.js';
import { refItem } from './layout.mjs';

const SOLID = new Set(['frame', 'table', 'node']);
const OWN = 48; // an arrow anchored to a control crosses its own frame to the edge; more than this is through it

// How much of a segment lies inside a box (Liang-Barsky clipping), the box's edge excluded.
function inside([a, b], r) {
  const [x0, y0, x1, y1] = [r.x + 1, r.y + 1, r.x + r.w - 1, r.y + r.h - 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let lo = 0;
  let hi = 1;
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
    if (p === 0) {
      if (q < 0) return 0;
    } else if (p < 0) lo = Math.max(lo, q / p);
    else hi = Math.min(hi, q / p);
  }
  return hi > lo ? (hi - lo) * Math.hypot(dx, dy) : 0;
}

export function checkArrows(items, arrows, boxOf, style = 'elbow') {
  const byId = new Map(arrows.map((a) => [a.id, a]));
  const solid = items.filter((i) => SOLID.has(i.type));
  const runs = resolve(arrows, items, boxOf).map((g) => {
    const shape = route(style, g.p0, g.n0, g.p1, g.n1, g.via);
    const w = pillWidth(g.label);
    const [x, y] = labelAt(shape.points, shape.mid, w, solid);
    return { id: g.id, segs: segments(shape.points), pill: g.label ? { x: x - w / 2, y: y - PILL_H / 2, w, h: PILL_H } : null };
  });
  const problems = [];
  for (const run of runs) {
    const arrow = byId.get(run.id);
    const own = new Set([refItem(arrow.from), refItem(arrow.to)]);
    for (const item of solid) {
      const length = run.segs.reduce((sum, s) => sum + inside(s, item), 0);
      if (length > (own.has(item.id) ? OWN : 1)) problems.push({ arrow: run.id, through: item.id, problem: `arrow ${run.id} runs through ${item.id}` });
    }
  }
  const covers = (p, r) => p.x < r.x + r.w && p.x + p.w > r.x && p.y < r.y + r.h && p.y + p.h > r.y;
  for (const run of runs) {
    const item = run.pill && solid.find((i) => covers(run.pill, i));
    if (item) problems.push({ arrow: run.id, label: item.id, problem: `the label of ${run.id} covers ${item.id}` });
  }
  for (let a = 0; a < runs.length; a++) {
    for (let b = a + 1; b < runs.length; b++) {
      if (runs[a].pill && runs[b].pill && covers(runs[a].pill, runs[b].pill)) problems.push({ arrows: [runs[a].id, runs[b].id], problem: `the labels of ${runs[a].id} and ${runs[b].id} overlap` });
    }
  }
  for (let a = 0; a < runs.length; a++) {
    for (let b = a + 1; b < runs.length; b++) {
      if (runs[a].segs.some((s) => runs[b].segs.some((t) => meets(s, t)))) problems.push({ arrows: [runs[a].id, runs[b].id], problem: `arrows ${runs[a].id} and ${runs[b].id} cross or overlap` });
    }
  }
  return problems;
}
