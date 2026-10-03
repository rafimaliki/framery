// The export controls in the detail panel: a format, a scale, and a button that downloads the selected
// frame, group or table as a file. The studio server makes the file (src/export.mjs); this is only
// the form and the download. The last choice is remembered.

import { api } from '../core/api.js';
import { h, icon } from '../core/dom.js';
import { segmented } from './segmented.js';

const FORMATS = [
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
  { value: 'svg', label: 'SVG' },
  { value: 'pdf', label: 'PDF' },
];
const SCALES = [
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
  { value: '3', label: '3×' },
];
const KEY = 'framery.export';

const load = () => {
  try {
    return { format: 'png', scale: '2', ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { format: 'png', scale: '2' };
  }
};
const save = (prefs) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // not remembered, nothing lost
  }
};

async function download(params) {
  const response = await fetch(api.exportUrl(params));
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `export failed (${response.status})`);
  const blob = await response.blob();
  const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? `${params.id}.${params.format}`;
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { name, size: response.headers.get('x-framery-size') };
}

export function exportControls({ project, page, id, what }) {
  const prefs = load();
  const status = h('p', { class: 'export__status' });
  const hint = h('p', { class: 'export__hint' });
  const go = h('button', { class: 'text-btn export__go', type: 'button' });
  const format = segmented({ label: 'Format', options: FORMATS, value: prefs.format, onChange: (value) => change({ format: value }) });
  const scale = segmented({ label: 'Scale', options: SCALES, value: prefs.scale, onChange: (value) => change({ scale: value }) });
  const scaleRow = h('div', { class: 'export__row' }, scale.el);

  function paint() {
    format.show(prefs.format);
    scale.show(prefs.scale);
    scaleRow.hidden = prefs.format === 'pdf';
    hint.textContent = prefs.format === 'svg' ? 'SVG embeds a picture of it. PDF keeps text sharp.' : prefs.format === 'pdf' ? 'One page at its own size; text stays text.' : '';
    hint.hidden = !hint.textContent;
    go.replaceChildren(h('span', { html: icon.download }), `Export ${what}`);
  }
  function change(patch) {
    Object.assign(prefs, patch);
    save(prefs);
    paint();
  }

  go.addEventListener('click', async () => {
    go.disabled = true;
    go.dataset.busy = 'true';
    status.textContent = 'Exporting…';
    try {
      const out = await download({ project, page, id, format: prefs.format, scale: prefs.scale, theme: document.documentElement.dataset.theme ?? 'light' });
      status.textContent = `Saved ${out.name}${out.size ? ` · ${out.size}` : ''}`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      go.disabled = false;
      delete go.dataset.busy;
    }
  });

  paint();
  return h('div', { class: 'export' }, h('span', { class: 'eyebrow' }, 'Export'), format.el, scaleRow, hint, go, status);
}
