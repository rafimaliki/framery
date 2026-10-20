// The divider between the page list and the layer tree, and the fold of the layer tree. Dragging (or the
// arrow keys on the focused bar) sets how much of the sidebar the page list may take; folding the layers gives
// the page list the full height. Both are remembered.

const SPLIT = 'framery.side.split';
const LAYERS = 'framery.side.layers';
const [MIN, MAX, DEFAULT, STEP] = [15, 60, 50, 3];

const get = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const set = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // not remembered, nothing lost
  }
};

export function createSplit({ side, bar, pagesBox, layersToggle }) {
  let pct = Number(get(SPLIT)) || DEFAULT;

  function paint() {
    side.style.setProperty('--split', `${pct}%`);
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  }
  function move(next, keep = true) {
    pct = Math.min(MAX, Math.max(MIN, next));
    paint();
    if (keep) set(SPLIT, pct === DEFAULT ? null : String(pct));
  }

  bar.addEventListener('pointerdown', (e) => {
    bar.setPointerCapture(e.pointerId);
    const drag = (ev) => move(((ev.clientY - pagesBox.getBoundingClientRect().top) / side.clientHeight) * 100, false);
    const stop = () => {
      bar.removeEventListener('pointermove', drag);
      bar.removeEventListener('pointerup', stop);
      bar.removeEventListener('pointercancel', stop);
      set(SPLIT, pct === DEFAULT ? null : String(pct));
    };
    bar.addEventListener('pointermove', drag);
    bar.addEventListener('pointerup', stop);
    bar.addEventListener('pointercancel', stop);
    e.preventDefault();
  });
  bar.addEventListener('keydown', (e) => {
    const dir = { ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (!dir) return;
    move(pct + dir * STEP);
    e.preventDefault();
  });
  bar.addEventListener('dblclick', () => move(DEFAULT));

  let folded = get(LAYERS) === 'folded';
  const paintFold = () => {
    side.toggleAttribute('data-layers-folded', folded);
    layersToggle.setAttribute('aria-expanded', String(!folded));
  };
  layersToggle.addEventListener('click', () => {
    folded = !folded;
    set(LAYERS, folded ? 'folded' : null);
    paintFold();
  });

  bar.setAttribute('aria-valuemin', String(MIN));
  bar.setAttribute('aria-valuemax', String(MAX));
  paint();
  paintFold();
}
