// Export a frame, a group, or any other item as an image or a document, with the local Chrome or Edge.
//
//   frame           its own html, alone, at its own size
//   group, others   the item and what is inside it, with the arrows between, drawn by the studio's
//                   export page (ui/export.html) with every frame live
//
//   png, webp  raster at 1x to 3x            pdf  one page, text stays text
//   svg        the png, embedded: it opens everywhere, but it is a picture, not editable vector.
//              (A browser cannot turn html into vector paths; pdf is the format that keeps text sharp.)

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { connect, findBrowser, launch } from './browser.mjs';
import { find } from './layout.mjs';
import { fail } from './store.mjs';

export const FORMATS = { png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', svg: 'image/svg+xml' };
const MAX_SIDE = 16000; // a browser cannot draw a texture larger than this on a side

const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

async function open(exe, { width, height, scale, transparent }) {
  const browser = launch(exe);
  const cdp = connect(await browser.url);
  await cdp.ready;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia', { media: 'screen' });
  if (transparent) await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  const go = async (url) => {
    let off;
    let timer;
    const loaded = new Promise((resolve) => {
      off = cdp.on((m) => m.sessionId === sessionId && m.method === 'Page.loadEventFired' && resolve());
      timer = setTimeout(resolve, 20000);
    });
    await send('Page.navigate', { url });
    await loaded;
    off();
    clearTimeout(timer);
  };
  const close = () => {
    cdp.close();
    browser.stop();
  };
  return { send, go, close };
}

async function capture(page, { format, width, height, scale }) {
  if (format === 'pdf') {
    const { data } = await page.send('Page.printToPDF', { printBackground: true, paperWidth: width / 96, paperHeight: height / 96, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, pageRanges: '1', preferCSSPageSize: false });
    return Buffer.from(data, 'base64');
  }
  const raster = format === 'webp' ? 'webp' : 'png';
  const { data } = await page.send('Page.captureScreenshot', { format: raster, ...(raster === 'webp' ? { quality: 92 } : {}), clip: { x: 0, y: 0, width, height, scale: 1 } });
  const bytes = Buffer.from(data, 'base64');
  if (format !== 'svg') return bytes;
  const href = `data:image/png;base64,${data}`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" xlink:href="${href}"/></svg>\n`);
}

export async function exportItem(store, a) {
  const format = a.format ?? 'png';
  if (!(format in FORMATS)) fail(`format must be one of ${Object.keys(FORMATS).join(', ')}`);
  const name = store.name(a.project);
  const pageId = a.page;
  const item = find(store.page(name, pageId), a.id);
  const exe = findBrowser();
  if (!exe) fail('no Chrome or Edge found; set FRAMERY_BROWSER to its path');

  let stop = async () => {};
  let page;
  let width;
  let height;
  let scale = Math.min(3, Math.max(1, Number(a.scale ?? 2)));
  const transparent = a.background === 'transparent' && format !== 'pdf';
  try {
    if (item.type === 'frame') {
      width = item.w;
      height = item.h;
      scale = Math.min(scale, MAX_SIDE / Math.max(width, height));
      page = await open(exe, { width, height, scale, transparent });
      await page.go(pathToFileURL(store.inside(name, item.src)).href);
      await page.send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true });
    } else {
      let base = a.base;
      if (!base) {
        const { serve } = await import('./server.mjs');
        const port = await freePort();
        const server = serve({ root: store.root, port, autoRender: false, quiet: true });
        await new Promise((resolve) => server.once('listening', resolve));
        base = `http://127.0.0.1:${port}`;
        stop = () => new Promise((resolve) => server.close(resolve));
      }
      page = await open(exe, { width: 1200, height: 800, scale: 1, transparent });
      const query = new URLSearchParams({ project: name, page: pageId, ids: item.id, theme: a.theme ?? 'light', lines: a.lines ?? 'elbow', background: a.background ?? 'paper' });
      await page.go(`${base}/export.html?${query}`);
      let size = null;
      for (let i = 0; i < 120 && !size; i++) {
        size = (await page.send('Runtime.evaluate', { expression: 'window.__export ?? null', returnByValue: true })).result.value;
        if (!size) await new Promise((r) => setTimeout(r, 250));
      }
      if (!size) fail('the export page did not finish loading');
      ({ width, height } = size);
      scale = Math.min(scale, MAX_SIDE / Math.max(width, height));
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
      await new Promise((r) => setTimeout(r, 300));
    }
    const bytes = await capture(page, { format, width, height, scale });
    const file = `exports/${item.id}${format === 'pdf' || scale === 1 ? '' : `@${Math.round(scale * 10) / 10}x`}.${format}`;
    mkdirSync(store.inside(name, 'exports'), { recursive: true });
    writeFileSync(store.inside(name, file), bytes);
    return { file, bytes: statSync(store.inside(name, file)).size, width: Math.round(width * (format === 'pdf' ? 1 : scale)), height: Math.round(height * (format === 'pdf' ? 1 : scale)), scale: format === 'pdf' ? 1 : scale, format };
  } finally {
    page?.close();
    await stop();
  }
}
