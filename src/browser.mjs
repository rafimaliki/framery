// Preview rendering with the Chrome or Edge already on the machine, driven over the DevTools protocol.
// One headless browser serves every frame, so a full render is one process, not one per frame. For each
// frame it writes a small WebP preview and the measured boxes of the elements an arrow can anchor to,
// and re-measures the height of frames marked autoHeight. Nothing is installed; no browser, no previews.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fail } from './store.mjs';
import { find, fitGroup } from './layout.mjs';

const SCALE = 0.5; // previews are half size: far zoom never needs more, and the file stays small
const WORKERS = 3;

export function findBrowser() {
  const env = process.env;
  if (env.FRAMERY_BROWSER) return env.FRAMERY_BROWSER;
  const win = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean).flatMap((base) => [
    join(base, 'Google/Chrome/Application/chrome.exe'),
    join(base, 'Microsoft/Edge/Application/msedge.exe'),
  ]);
  const mac = ['Google Chrome', 'Microsoft Edge', 'Chromium'].map((n) => `/Applications/${n}.app/Contents/MacOS/${n}`);
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
  const onPath = (env.PATH ?? '').split(delimiter).flatMap((dir) => names.map((n) => join(dir, n)));
  return [...win, ...mac, ...onPath].find((path) => existsSync(path));
}

export function connect(url) {
  const socket = new WebSocket(url);
  let id = 0;
  const waiting = new Map();
  const listeners = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id);
      waiting.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    } else listeners.forEach((fn) => fn(message));
  };
  const ready = new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('could not reach the browser'));
  });
  return {
    ready,
    send: (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        waiting.set(++id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      }),
    on: (fn) => {
      listeners.push(fn);
      return () => listeners.splice(listeners.indexOf(fn), 1);
    },
    close: () => socket.close(),
  };
}

export function launch(exe) {
  const profile = mkdtempSync(join(tmpdir(), 'framery-'));
  const child = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const url = new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error('browser did not start')), 15000);
    child.stderr.on('data', (chunk) => {
      log += chunk;
      const found = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (found) {
        clearTimeout(timer);
        resolve(found[1]);
      }
    });
    child.on('exit', () => reject(new Error('browser exited early')));
  });
  const stop = () => {
    child.kill();
    setTimeout(() => rmSync(profile, { recursive: true, force: true, maxRetries: 5 }), 500).unref();
  };
  return { url, stop };
}

// What the page reports about itself, in frame pixels.
const MEASURE = `(async () => {
  await document.fonts.ready;
  const app = document.querySelector('.app');
  const height = app ? Math.ceil(app.getBoundingClientRect().height) : Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  const q = (n) => Math.round(n * 100) / 100;
  const anchors = {};
  for (const el of document.querySelectorAll('[data-anchor],[id]')) {
    const key = el.dataset.anchor || el.id;
    if (!key || anchors[key]) continue;
    const r = el.getBoundingClientRect();
    if (r.width || r.height) anchors[key] = [q(r.x), q(r.y + scrollY), q(r.width), q(r.height)];
  }
  // where each component instance sits in the frame, so the studio can outline the component itself
  const parts = {};
  for (const el of document.querySelectorAll('[data-fr-component]')) {
    const r = el.getBoundingClientRect();
    (parts[el.dataset.frComponent] ||= []).push([q(r.x), q(r.y + scrollY), q(r.width), q(r.height)]);
  }
  // text that is hard to read: each element's own text against the background really behind it (WCAG:
  // 4.5:1, or 3:1 for large text). Colours go through a 1px canvas, so any css colour syntax works.
  const pen = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  const rgba = (css) => {
    pen.clearRect(0, 0, 1, 1);
    pen.fillStyle = '#000';
    pen.fillStyle = css;
    pen.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = pen.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const behind = (el) => {
    const layers = [];
    for (let at = el; at; at = at.parentElement) layers.push(rgba(getComputedStyle(at).backgroundColor));
    return layers.reverse().reduce((under, top) => over(top, under), [255, 255, 255, 1]);
  };
  const lum = ([r, g, b]) => [r, g, b].map((c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const hex = (c) => '#' + c.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
  const contrast = [];
  for (const el of document.body.querySelectorAll('*')) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!own) continue;
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || style.visibility === 'hidden' || +style.opacity === 0) continue;
    const bg = behind(el);
    const fg = over(rgba(style.color), bg);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    const size = parseFloat(style.fontSize);
    const need = size >= 24 || (size >= 18.66 && +style.fontWeight >= 700) ? 3 : 4.5;
    if (ratio < need) contrast.push({ text: own.slice(0, 40), ratio: q(ratio), need, fg: hex(fg), bg: hex(bg), box: [q(r.x), q(r.y + scrollY), q(r.width), q(r.height)] });
  }
  return { height, anchors, parts, contrast };
})()`;

async function shoot(cdp, session, file, frame) {
  const send = (method, params) => cdp.send(method, params, session);
  // An autoHeight frame is measured in a short window, so a page that fills the window (min-height: 100vh)
  // reports what it needs rather than the size it was given, and a frame can shrink as well as grow.
  const probe = frame.autoHeight ? Math.min(frame.h, 120) : frame.h;
  await send('Emulation.setDeviceMetricsOverride', { width: frame.w, height: probe, deviceScaleFactor: 1, mobile: false });
  let off;
  let timer;
  const loaded = new Promise((resolve) => {
    off = cdp.on((m) => m.sessionId === session && m.method === 'Page.loadEventFired' && resolve());
    timer = setTimeout(resolve, 15000);
  });
  await send('Page.navigate', { url: pathToFileURL(file).href });
  await loaded;
  off();
  clearTimeout(timer);
  const { result } = await send('Runtime.evaluate', { expression: MEASURE, awaitPromise: true, returnByValue: true });
  const measured = result.value;
  const height = frame.autoHeight && measured.height > 0 ? measured.height : frame.h;
  if (height !== probe) await send('Emulation.setDeviceMetricsOverride', { width: frame.w, height, deviceScaleFactor: 1, mobile: false });
  const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 72, clip: { x: 0, y: 0, width: frame.w, height, scale: SCALE } });
  return { height, anchors: measured.anchors, parts: measured.parts, contrast: measured.contrast, image: Buffer.from(data, 'base64') };
}

const depsMtime = (store, project) => {
  const dir = store.dir(project);
  return Math.max(0, ...readdirSync(dir).filter((n) => /\.(css|js)$/.test(n)).map((n) => store.mtime(join(dir, n))));
};

export async function render(store, args = {}, onProgress = () => {}) {
  const project = store.name(args.project);
  const info = store.project(project);
  const exe = findBrowser();
  if (!exe) fail('no Chrome or Edge found; set FRAMERY_BROWSER to its path. Previews are optional: the studio still works.');

  const wanted = args.ids ? new Set(args.ids) : null;
  const deps = depsMtime(store, project);
  const todo = [];
  let skipped = 0;
  for (const { id: pageName } of info.pages ?? []) {
    if (args.page && args.page !== pageName) continue;
    for (const item of store.page(project, pageName).items ?? []) {
      if (item.type !== 'frame' || (wanted && !wanted.has(item.id))) continue;
      const meta = store.inside(project, `.cache/anchors/${item.id}.json`);
      const known = existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')) : null;
      const srcTime = store.mtime(store.inside(project, item.src));
      const fresh = known && known.contrast && known.src === srcTime && known.deps === deps && known.w === item.w && known.h === item.h && existsSync(store.inside(project, `.cache/frames/${item.id}.webp`));
      if (fresh && !args.force) skipped++;
      else todo.push({ page: pageName, item, srcTime });
    }
  }
  if (!todo.length) return { rendered: 0, skipped, resized: [], browser: exe };

  const started = Date.now();
  const browser = launch(exe);
  const cdp = connect(await browser.url);
  await cdp.ready;
  const resized = [];
  const failed = [];
  let done = 0;
  try {
    mkdirSync(store.inside(project, '.cache/frames'), { recursive: true });
    mkdirSync(store.inside(project, '.cache/anchors'), { recursive: true });
    const queue = [...todo];
    const worker = async () => {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Page.enable', {}, sessionId);
      for (let job = queue.shift(); job; job = queue.shift()) {
        const { item, srcTime, page } = job;
        try {
          const out = await shoot(cdp, sessionId, store.inside(project, item.src), item);
          writeFileSync(store.inside(project, `.cache/frames/${item.id}.webp`), out.image);
          if (out.height !== item.h) resized.push({ page, id: item.id, from: item.h, to: out.height });
          writeFileSync(store.inside(project, `.cache/anchors/${item.id}.json`), JSON.stringify({ src: srcTime, deps, w: item.w, h: out.height, anchors: out.anchors, parts: out.parts, contrast: out.contrast }));
        } catch (error) {
          failed.push({ id: item.id, error: error.message });
        }
        onProgress({ done: ++done, total: todo.length, id: item.id });
      }
      await cdp.send('Target.closeTarget', { targetId });
    };
    await Promise.all(Array.from({ length: Math.min(WORKERS, todo.length) }, worker));
  } finally {
    cdp.close();
    browser.stop();
  }

  // Heights that changed go back into the page files, and the groups around them regrow. The cache
  // meta keeps the new height, so the next run sees these frames as fresh.
  for (const pageName of new Set(resized.map((r) => r.page))) {
    const page = store.page(project, pageName);
    for (const r of resized.filter((x) => x.page === pageName)) {
      const frame = find(page, r.id);
      frame.h = r.to;
      if (frame.parent) fitGroup(page, frame.parent);
    }
    store.savePage(project, pageName, page);
  }
  return { rendered: todo.length - failed.length, skipped, resized, failed, ms: Date.now() - started, browser: exe };
}
