// Studio settings: theme, motion and how arrows are drawn. They live in localStorage, are applied as
// attributes on <html> (tokens.css keys off the first two), and are announced on the bus. The device's
// own reduced-motion preference is deliberately not read: motion is the default, and this is where it
// is turned down.

import { bus } from './bus.js';

const KEY = 'framery.settings';
const DEFAULTS = { theme: 'system', motion: 'full', lines: 'elbow', arrows: 'focus' };
const THEMES = ['system', 'light', 'dark'];
const MOTIONS = ['full', 'reduced'];
const ARROWS = ['all', 'focus', 'none']; // which arrows show: every one, those of the focused frame or group, none
const LINES = ['straight', 'curved', 'elbow']; // elbow: straight segments that turn at right angles

const dark = matchMedia('(prefers-color-scheme: dark)');
let state = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      theme: THEMES.includes(saved.theme) ? saved.theme : DEFAULTS.theme,
      motion: MOTIONS.includes(saved.motion) ? saved.motion : DEFAULTS.motion,
      lines: LINES.includes(saved.lines) ? saved.lines : DEFAULTS.lines,
      arrows: ARROWS.includes(saved.arrows) ? saved.arrows : DEFAULTS.arrows,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

const resolved = () => (state.theme === 'system' ? (dark.matches ? 'dark' : 'light') : state.theme);

function apply({ animate }) {
  const root = document.documentElement;
  if (animate && state.motion === 'full') {
    root.classList.add('theming');
    setTimeout(() => root.classList.remove('theming'), 360);
  }
  root.dataset.theme = resolved();
  root.dataset.motion = state.motion;
}

dark.addEventListener('change', () => state.theme === 'system' && apply({ animate: true }));
apply({ animate: false });

export const settings = {
  options: { theme: THEMES, motion: MOTIONS, lines: LINES, arrows: ARROWS },
  get: () => ({ ...state }),
  animated: () => state.motion === 'full',
  lineStyle: () => state.lines,
  arrowMode: () => state.arrows,
  set(patch) {
    state = { ...state, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // a private window: the setting still applies for this visit
    }
    apply({ animate: 'theme' in patch });
    bus.emit('settings', settings.get());
  },
};
