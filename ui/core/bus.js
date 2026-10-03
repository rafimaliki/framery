// A minimal event bus. Modules talk through named events instead of holding each other.
//
//   project   the open project's info changed        page      the open page's data changed
//   select    the selection changed                   settings  a setting changed
//   view      the camera moved
//   cache     previews or measured anchors changed    frames    a frame's html or the css changed

const listeners = new Map();

export const bus = {
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  },
  emit(type, detail) {
    for (const fn of listeners.get(type) ?? []) fn(detail);
  },
};
