// The studio's HTTP door: the UI, each project's files, a JSON API over the command table, and a
// server-sent-events stream that tells open pages what changed on disk. Local only: it binds to
// 127.0.0.1, refuses a Host it does not own, and takes writes only as same-origin JSON.

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, watch } from 'node:fs';
import { createGzip } from 'node:zlib';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FramError, Store } from './store.mjs';
import { commands, run } from './commands.mjs';
import { sync } from './library.mjs';
import { record } from './history.mjs';

const UI = resolve(fileURLToPath(new URL('../ui', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const SQUEEZE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg']);

export function serve({ root, port = 4173, autoRender = true, quiet = false }) {
  const watchers = [];
  const store = new Store(root);
  const streams = new Set();

  const send = (event) => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const stream of streams) stream.write(data);
  };

  // ---- watching ----------------------------------------------------------------------------------
  const changed = new Set();
  let flush = null;
  let renderTimer = null;
  let trailTimer = null;
  const edited = new Set();
  function trail() {
    for (const project of edited) {
      try {
        record(store, project);
      } catch (error) {
        console.error(`history (${project}): ${error.message}`);
      }
    }
    edited.clear();
  }
  let rendering = false;

  async function renderNow(args = {}) {
    if (rendering) return { busy: true };
    rendering = true;
    try {
      const { render } = await import('./browser.mjs');
      send({ type: 'render', done: 0, total: 0 });
      const total = { rendered: 0, skipped: 0, resized: [], failed: [] };
      for (const project of args.project ? [args.project] : store.projects()) {
        const part = await render(store, { ...args, project }, (p) => send({ type: 'render', project, ...p }));
        total.rendered += part.rendered;
        total.skipped += part.skipped;
        total.resized.push(...part.resized);
        total.failed.push(...(part.failed ?? []));
      }
      send({ type: 'render-end', ...total });
      return total;
    } finally {
      rendering = false;
    }
  }

  function classify(name) {
    const parts = name.split(/[\\/]/);
    const [project, ...rest] = parts;
    const path = rest.join('/');
    if (!rest.length || /\.(tmp|removed)$/.test(path) || /\.tmp$/.test(name)) return null;
    if (rest[0] === '.cache') return { type: 'cache', project };
    if (rest[0] === '.history') return path.startsWith('.history/lock') ? null : { type: 'history', project };
    if (path === 'project.json') return { type: 'project', project };
    if (path === 'library.json' || rest[0] === 'library') return { type: 'library', project };
    if (rest[0] === 'pages') return { type: 'page', project, page: path.replace(/^pages\//, '').replace(/\.json$/, '') };
    if (/\.(css|js)$/.test(path)) return { type: 'assets', project, path };
    if (path.endsWith('.html')) return { type: 'frame', project, path };
    return null;
  }

  try {
    watchers.push(watch(store.root, { recursive: true }, (_kind, name) => {
      const event = name && classify(name);
      if (!event) return;
      changed.add(JSON.stringify(event));
      clearTimeout(flush);
      flush = setTimeout(() => {
        const events = [...changed].map((s) => JSON.parse(s));
        changed.clear();
        // A component definition changed: every frame that uses it is rewritten, and those writes come
        // back through this watcher as frame changes, which reload them and redraw their previews.
        for (const project of new Set(events.filter((e) => e.type === 'library').map((e) => e.project))) {
          try {
            const result = sync(store, project);
            if (result.problems.length) console.error(`components (${project}):`, result.problems.join('; '));
          } catch (error) {
            console.error(`components (${project}): ${error.message}`);
          }
        }
        send({ type: 'changed', events });
        // edits that came from outside the tools (an editor, an agent's own file edits) go on the trail once things go quiet
        for (const e of events) if (e.type !== 'cache' && e.type !== 'history') edited.add(e.project);
        clearTimeout(trailTimer);
        trailTimer = setTimeout(trail, 2000);
        if (autoRender && events.some((e) => e.type === 'frame' || e.type === 'assets')) {
          clearTimeout(renderTimer);
          renderTimer = setTimeout(() => renderNow().catch(() => {}), 400);
        }
      }, 90);
    }));
  } catch (error) {
    console.error('watching unavailable, pages will not live-reload:', error.message);
  }

  // The studio's own files: an edit to the UI reloads open pages, so nobody refreshes by hand.
  let uiTimer = null;
  try {
    watchers.push(
      watch(UI, { recursive: true }, () => {
        clearTimeout(uiTimer);
        uiTimer = setTimeout(() => send({ type: 'reload' }), 150);
      }),
    );
  } catch {
    // no recursive watch here: the studio's own files will not live-reload
  }

  // ---- requests ----------------------------------------------------------------------------------
  const json = (response, status, body) => {
    response.writeHead(status, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' }).end(JSON.stringify(body));
  };

  function file(request, response, path) {
    let info;
    try {
      info = statSync(path);
    } catch {
      return response.writeHead(404, { 'content-type': TYPES['.html'] }).end('Not found');
    }
    if (info.isDirectory()) return file(request, response, join(path, 'index.html'));
    const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
    const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
    const headers = { 'content-type': type, etag, 'cache-control': 'no-cache', vary: 'accept-encoding' };
    if (request.headers['if-none-match'] === etag) return response.writeHead(304, headers).end();
    const squeeze = SQUEEZE.has(extname(path).toLowerCase()) && info.size > 1024 && /\bgzip\b/.test(request.headers['accept-encoding'] ?? '');
    if (squeeze) headers['content-encoding'] = 'gzip';
    else headers['content-length'] = info.size;
    response.writeHead(200, headers);
    const stream = createReadStream(path);
    stream.on('error', () => response.destroy());
    (squeeze ? stream.pipe(createGzip({ level: 6 })) : stream).pipe(response);
  }

  const inside = (base, path) => {
    const full = resolve(base, '.' + normalize('/' + path));
    return full === base || full.startsWith(base + sep) ? full : null;
  };

  const handler = async (request, response) => {
    const host = request.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return response.writeHead(403).end('Forbidden');
    const url = new URL(request.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);

    if (path === '/__events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      response.write(': open\n\n');
      streams.add(response);
      const beat = setInterval(() => response.write(': ping\n\n'), 25000);
      request.on('close', () => {
        clearInterval(beat);
        streams.delete(response);
      });
      return;
    }

    if (path === '/api/projects') {
      const list = store.projects().map((name) => ({ name, title: store.project(name).title ?? name }));
      return json(response, 200, list);
    }

    if (path === '/api/components') {
      try {
        return json(response, 200, await run(store, 'list_components', { project: url.searchParams.get('project') ?? undefined }));
      } catch (error) {
        return json(response, error instanceof FramError ? 400 : 500, { error: error.message });
      }
    }

    if (path === '/api/tools') {
      return json(response, 200, Object.entries(commands).map(([name, c]) => ({ name, description: c.description, inputSchema: c.input })));
    }

    if (path === '/api/cmd') {
      const origin = request.headers.origin;
      if (request.method !== 'POST' || (origin && new URL(origin).host !== host) || !/application\/json/.test(request.headers['content-type'] ?? '')) {
        return json(response, 400, { error: 'POST same-origin JSON {name, args}' });
      }
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 1e6) return json(response, 413, { error: 'too large' });
      }
      try {
        const { name, args } = JSON.parse(body);
        const result = name === 'render_frames' ? await renderNow(args ?? {}) : await run(store, name, args ?? {});
        return json(response, 200, { result });
      } catch (error) {
        return json(response, error instanceof FramError ? 400 : 500, { error: error.message });
      }
    }

    // A download: the studio asks for an item as an image or a document and gets the file back.
    if (path === '/api/export') {
      const site = request.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return json(response, 403, { error: 'same-origin only' });
      const q = url.searchParams;
      try {
        const out = await run(store, 'export_item', {
          project: q.get('project') ?? undefined,
          page: q.get('page') ?? undefined,
          id: q.get('id'),
          format: q.get('format') ?? 'png',
          scale: Number(q.get('scale') ?? 2),
          background: q.get('background') ?? 'paper',
          theme: q.get('theme') ?? 'light',
          lines: q.get('lines') ?? 'elbow',
          base: `http://127.0.0.1:${port}`,
        });
        const target = store.inside(store.name(q.get('project') ?? undefined), out.file);
        response.writeHead(200, {
          'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
          'content-disposition': `attachment; filename="${out.file.split('/').pop()}"`,
          'x-framery-size': `${out.width}x${out.height}`,
          'x-framery-scale': String(out.scale), // lower than asked when the item was too large for it
          'cache-control': 'no-store',
        });
        return createReadStream(target).pipe(response);
      } catch (error) {
        return json(response, error instanceof FramError ? 400 : 500, { error: error.message });
      }
    }

    if (path.startsWith('/p/')) {
      const [, , project, ...rest] = path.split('/');
      if (!store.projects().includes(project)) return response.writeHead(404).end('Not found');
      const target = inside(store.dir(project), rest.join('/'));
      return target ? file(request, response, target) : response.writeHead(403).end('Forbidden');
    }

    const target = inside(UI, path === '/' ? 'index.html' : path);
    return target && existsSync(target) ? file(request, response, target) : response.writeHead(404).end('Not found');
  };

  const server = createServer((request, response) => {
    handler(request, response).catch((error) => {
      if (!response.headersSent) response.writeHead(500);
      response.end(String(error.message));
    });
  });
  server.on('close', () => watchers.forEach((w) => w.close()));
  server.listen(port, '127.0.0.1', () => {
    if (!quiet) console.log(`framery  http://127.0.0.1:${port}/   data: ${store.root}`);
    if (autoRender) renderNow().then((r) => r && !r.busy && r.rendered && console.log(`previews: ${r.rendered} rendered, ${r.skipped} fresh`), (e) => console.log(`previews off: ${e.message}`));
  });
  return server;
}
