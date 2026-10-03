// The settings popover: light or dark, how arrows are drawn, and whether the studio animates. Each is
// applied by core/settings; this panel is only the controls and the open/close behaviour.

import { h } from '../core/dom.js';
import { icon } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { segmented } from './segmented.js';

const THEME = [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];
const MOTION = [{ value: 'full', label: 'Full' }, { value: 'reduced', label: 'Reduced' }];
const LINES = [{ value: 'straight', label: 'Straight' }, { value: 'curved', label: 'Curved' }, { value: 'elbow', label: 'Elbow' }];

export function createSettingsMenu({ button, panel }, settings) {
  button.innerHTML = icon.gear;
  const current = settings.get();
  const theme = segmented({ label: 'Theme', options: THEME, value: current.theme, onChange: (value) => settings.set({ theme: value }) });
  const motion = segmented({ label: 'Motion', options: MOTION, value: current.motion, onChange: (value) => settings.set({ motion: value }) });
  const lines = segmented({ label: 'Arrow lines', options: LINES, value: current.lines, onChange: (value) => settings.set({ lines: value }) });

  panel.replaceChildren(
    h('div', { class: 'settings__row' }, h('span', { class: 'eyebrow' }, 'Theme'), theme.el),
    h(
      'div',
      { class: 'settings__row' },
      h('span', { class: 'eyebrow' }, 'Arrow lines'),
      lines.el,
      h('p', { class: 'settings__hint' }, 'Elbow is straight segments that turn at right angles.'),
    ),
    h(
      'div',
      { class: 'settings__row' },
      h('span', { class: 'eyebrow' }, 'Motion'),
      motion.el,
      h('p', { class: 'settings__hint' }, 'Animations are on by default, whatever your device prefers. Reduced removes them.'),
    ),
  );

  const set = (open) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    set(panel.hidden);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) set(false);
  });
  document.addEventListener('keydown', (event) => event.key === 'Escape' && !panel.hidden && set(false));

  bus.on('settings', (next) => {
    theme.show(next.theme);
    motion.show(next.motion);
    lines.show(next.lines);
  });
}
