// A tiny element builder and the handful of icons the chrome uses. No templates, no innerHTML on
// data: text goes in as text.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'html') el.innerHTML = value; // only ever our own icon strings
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...kids.flat().filter((kid) => kid != null && kid !== false));
  return el;
}

const svg = (body, box = 20) => `<svg viewBox="0 0 ${box} ${box}" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icon = {
  frame: svg('<rect x="5" y="2.5" width="10" height="15" rx="2.5"/><path d="M8.5 15h3"/>'),
  desktop: svg('<rect x="2.5" y="4" width="15" height="10" rx="1.5"/><path d="M7 17h6M10 14v3"/>'),
  group: svg('<rect x="2.5" y="2.5" width="15" height="15" rx="3" stroke-dasharray="2.4 2.4"/>'),
  node: svg('<path d="M10 2.5 17.5 10 10 17.5 2.5 10Z"/>'),
  process: svg('<rect x="2.5" y="5.5" width="15" height="9" rx="2"/>'),
  terminal: svg('<rect x="2.5" y="6" width="15" height="8" rx="4"/>'),
  page: svg('<path d="M5 2.5h6.5L15 6v11.5H5Z"/><path d="M11.5 2.5V6H15"/>'),
  plan: svg('<path d="M3 5h14M3 10h14M3 15h9"/>'),
  plus: svg('<path d="M10 4v12M4 10h12"/>'),
  arrowsAll: svg('<path d="M3 6h11M11 3l3 3-3 3M3 14h11M11 11l3 3-3 3"/>'),
  arrowsFocus: svg('<path d="M3 10h9M9 7l3 3-3 3"/><circle cx="16" cy="10" r="1.6"/>'),
  arrowsNone: svg('<path d="M3 10h11M11 7l3 3-3 3M3.5 3.5l13 13"/>'),
  play: svg('<path d="M6 4v12l10-6Z"/>'),
  back: svg('<path d="M12 4 6 10l6 6"/>'),
  warn: svg('<path d="M10 3 18 17H2Z"/><path d="M10 8v4M10 14.5v.01"/>'),
  minus: svg('<path d="M4 10h12"/>'),
  fit: svg('<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/>'),
  sun: svg('<circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>'),
  moon: svg('<path d="M16.5 11.5A6.5 6.5 0 0 1 8.5 3.5a6.5 6.5 0 1 0 8 8Z"/>'),
  gear: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>', 24),  // gear: Lucide, ISC licence
  sidebar: svg('<rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><path d="M7.5 3.5v13"/>'),
  component: svg('<path d="M10 2 12.5 4.5 10 7 7.5 4.5Z"/><path d="M4.5 7.5 7 10l-2.5 2.5L2 10Z"/><path d="M15.5 7.5 18 10l-2.5 2.5L13 10Z"/><path d="M10 13l2.5 2.5L10 18l-2.5-2.5Z"/>'),
  download: svg('<path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 15.5h12"/>'),
  menu: svg('<path d="M3 5.5h14M3 10h14M3 14.5h14"/>'),
  close: svg('<path d="m5 5 10 10M15 5 5 15"/>'),
  caret: svg('<path d="m7 4 6 6-6 6"/>'),
  history: svg('<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 1.5"/>'),
  link: svg('<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9M11.5 8.5a3 3 0 0 0-4.2 0L4.7 11.1a3 3 0 0 0 4.2 4.2l.9-.9"/>'),
};
