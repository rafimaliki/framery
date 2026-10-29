// The export controls in the detail panel: a format, a scale, and a button that downloads the selected
// frame, group or table as a file, or copies it to the clipboard (PNG as an image, SVG as its source text).
// The studio server makes the file (src/export.mjs); this is only the form, the download and the copy.
// The last choice is remembered.

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
  return { name, size: response.headers.get('x-framery-size'), scale: Number(response.headers.get('x-framery-scale')) };
}

// Copy goes through the same endpoint. The clipboard takes PNG as an image and has no WebP or PDF, so WebP copies as PNG
// and PDF has no copy. The blob is passed as a promise so the click still counts as the user gesture the clipboard needs.
async function copy(params) {
  const asText = params.format === 'svg';
  const type = asText ? 'text/plain' : 'image/png';
  const blob = (async () => {
    const response = await fetch(api.exportUrl({ ...params, format: asText ? 'svg' : 'png' }));
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `export failed (${response.status})`);
    const out = await response.blob();
    return asText ? new Blob([await out.text()], { type }) : out;
  })();
  await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
  return asText ? 'SVG source' : 'PNG';
}

export function exportControls({ project, page, id, what }) {
  const prefs = load();
  const status = h('p', { class: 'export__status' });
  const hint = h('p', { class: 'export__hint' });
  const go = h('button', { class: 'text-btn export__go', type: 'button' });
  const copyBtn = h('button', { class: 'icon-btn export__copy', type: 'button', title: 'Copy to the clipboard', 'aria-label': 'Copy to the clipboard' });
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
    copyBtn.replaceChildren(h('span', { html: icon.copy }));
    copyBtn.hidden = prefs.format === 'pdf' || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined';
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
      // src/export.mjs lowers the scale of an item too large to draw at the one asked for: say so, and what keeps it sharp
      if (prefs.format !== 'pdf' && out.scale && out.scale < Number(prefs.scale) - 0.01) {
        status.textContent += `. Exported at ${Math.round(out.scale * 100) / 100}×: too large for ${prefs.scale}×. Use PDF for sharp text.`;
      }
    } catch (error) {
      status.textContent = error.message;
    } finally {
      go.disabled = false;
      delete go.dataset.busy;
    }
  });

  copyBtn.addEventListener('click', async () => {
    copyBtn.disabled = true;
    status.textContent = 'Copying…';
    try {
      const what = await copy({ project, page, id, format: prefs.format, scale: prefs.scale, theme: document.documentElement.dataset.theme ?? 'light' });
      status.textContent = `Copied ${what} to the clipboard`;
    } catch (error) {
      status.textContent = error.message || 'Could not copy. The browser may have blocked the clipboard.';
    } finally {
      copyBtn.disabled = false;
    }
  });

  paint();
  return h('div', { class: 'export' }, h('span', { class: 'eyebrow' }, 'Export'), format.el, scaleRow, hint, h('div', { class: 'export__actions' }, go, copyBtn), status);
}
