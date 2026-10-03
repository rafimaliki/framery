// What the server measured inside each frame when it rendered it (browser.mjs), cached beside the
// preview: the boxes of elements an arrow can anchor to, and where each component instance sits. This
// module reads that cache lazily, once per frame, and says when something new arrived.

import { api } from '../core/api.js';

export function createAnchors({ project, rev }) {
  const known = new Map(); // frame id -> { anchors: { name: [x, y, w, h] }, parts: { component: [[x, y, w, h], …] } } | null
  const asked = new Set();

  return {
    box: (frameId, name) => known.get(frameId)?.anchors?.[name] ?? null,

    // The boxes of a component's instances in a frame, in frame pixels; every component when none is named.
    parts(frameId, component) {
      const all = known.get(frameId)?.parts ?? {};
      return component ? (all[component] ?? []).map((box, at) => ({ component, at, box })) : Object.entries(all).flatMap(([id, boxes]) => boxes.map((box, at) => ({ component: id, at, box })));
    },

    // Fetch what is missing for these frames; onLoad runs once if any of it arrived.
    async ensure(frameIds, onLoad) {
      const missing = [...new Set(frameIds)].filter((id) => !asked.has(id));
      missing.forEach((id) => asked.add(id));
      if (!missing.length) return;
      await Promise.all(
        missing.map((id) =>
          api.anchors(project(), id, rev()).then(
            (meta) => known.set(id, { anchors: meta.anchors ?? {}, parts: meta.parts ?? {} }),
            () => known.set(id, null),
          ),
        ),
      );
      onLoad();
    },

    // Previews were re-rendered, so every measurement may have moved.
    forget() {
      known.clear();
      asked.clear();
    },
  };
}
