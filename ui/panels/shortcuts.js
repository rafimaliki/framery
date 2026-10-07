// Keyboard: the canvas keys, active whenever the person is not typing in a field.

const typing = (el) => el && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable);

const end = (ref) => ref.split('#')[0];
const TONE_ORDER = { positive: 0, neutral: 1, negative: 2 }; // the happy path first at a branch

// The item one step along the flow from a selection: dir 1 follows an arrow out, -1 one in. An arrow
// selection steps to its target or source. With nothing selected, the flow's start: an item with arrows
// out and none in, the top-left one first.
export function along(page, sel, dir) {
  const arrows = page.arrows ?? [];
  if (sel?.kind === 'arrow') {
    const arrow = arrows.find((a) => a.id === sel.id);
    return arrow ? end(dir > 0 ? arrow.to : arrow.from) : null;
  }
  const at = sel?.kind === 'component' ? sel.frame : sel?.id;
  if (!at) {
    const starts = page.items.filter((i) => arrows.some((a) => end(a.from) === i.id) && !arrows.some((a) => end(a.to) === i.id));
    return starts.sort((a, b) => a.y - b.y || a.x - b.x)[0]?.id ?? null;
  }
  const [mine, other] = dir > 0 ? ['from', 'to'] : ['to', 'from'];
  const ways = arrows.filter((a) => end(a[mine]) === at).sort((a, b) => (TONE_ORDER[a.tone] ?? 1) - (TONE_ORDER[b.tone] ?? 1));
  return ways.length ? end(ways[0][other]) : null;
}

export function installShortcuts({ canvas, toggleSidebar, clearSelection, enabled, walk, find }) {
  addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      return find();
    }
    if (event.metaKey || event.ctrlKey || event.altKey || typing(document.activeElement)) return;
    if (event.key === '[') {
      event.preventDefault();
      return toggleSidebar();
    }
    if (!enabled()) return;
    const step = event.shiftKey ? 160 : 60;
    const run = {
      0: () => canvas.fitAll(),
      1: () => canvas.zoomTo(1),
      '=': () => canvas.zoomBy(1.25),
      '+': () => canvas.zoomBy(1.25),
      '-': () => canvas.zoomBy(1 / 1.25),
      Escape: clearSelection,
      '.': () => walk(1), // next screen along the flow
      ',': () => walk(-1), // the one before
      '/': find, // find on any page
      ArrowLeft: () => canvas.pan(step, 0),
      ArrowRight: () => canvas.pan(-step, 0),
      ArrowUp: () => canvas.pan(0, step),
      ArrowDown: () => canvas.pan(0, -step),
    }[event.key];
    if (!run) return;
    event.preventDefault();
    run();
  });
}
