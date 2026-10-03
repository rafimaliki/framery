// The component commands. They sit in the same table as every other command (commands.mjs spreads this
// object into it), so the MCP server, the HTTP API and the CLI all expose them.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cmd, project, t } from './kit.mjs';
import { checkName, fail } from './store.mjs';
import { detach, htmlFiles, loadLibrary, marker, regionsOf, renameInHtml, render, saveLibrary, sync, usage } from './library.mjs';
import { adopt, promote, scan } from './candidates.mjs';

const TYPES = ['text', 'html', 'enum', 'flag'];
const propSchema = { type: 'object', description: '{ propName: { type: "text"|"html"|"enum"|"flag", default?, values?: {key: "classes"}, output? } }' };

function checkProps(props = {}) {
  for (const [name, spec] of Object.entries(props)) {
    checkName('prop', name);
    if (!TYPES.includes(spec?.type)) fail(`prop ${name}: type must be one of ${TYPES.join(', ')}`);
    if (spec.type === 'enum' && !spec.values) fail(`prop ${name}: an enum needs values`);
    if (spec.type === 'flag' && typeof spec.output !== 'string') fail(`prop ${name}: a flag needs output`);
  }
}

// Which frames (page items) use which files, so usage can say "frame 6.3" and not only a path.
function framesBySrc(store, name) {
  const out = {};
  for (const { id: pageId } of store.project(name).pages ?? []) {
    for (const item of store.page(name, pageId).items ?? []) if (item.type === 'frame') (out[item.src] ??= []).push({ page: pageId, id: item.id, title: item.title });
  }
  return out;
}

function describe(store, name) {
  const lib = loadLibrary(store, name);
  const used = usage(store, name);
  const frames = framesBySrc(store, name);
  return Object.entries(lib.components).map(([id, def]) => ({
    id,
    title: def.title,
    description: def.description,
    props: def.props,
    uses: used[id]?.total ?? 0,
    frames: Object.entries(used[id]?.files ?? {}).flatMap(([file, count]) => (frames[file] ?? [{ file }]).map((f) => ({ ...f, count, instances: used[id].items[file] }))),
  }));
}

const afterEdit = (store, name) => ({ synced: sync(store, name) });

export const componentCommands = {
  list_components: cmd('The component library: each component with its props, how many times it is used, and the frames that use it.', { project }, [], (store, a) => describe(store, store.name(a.project))),

  component_usage: cmd('Where one component is used: the frames and the count in each.', { project, id: t.str('component id') }, ['id'], (store, a) => {
    const name = store.name(a.project);
    const found = describe(store, name).find((c) => c.id === a.id);
    if (!found) fail(`no component ${a.id}`);
    return { id: a.id, uses: found.uses, frames: found.frames };
  }),

  create_component: cmd(
    'Add a component: an html fragment with {{prop}} placeholders and its props. Use it with use_component, or write its marker in a frame and run sync_components.',
    { project, id: t.str('component id'), title: t.str('shown in the design system'), description: t.str('what it is for'), html: t.str('the fragment, one root element, {{prop}} where a prop goes'), props: propSchema },
    ['id', 'html'],
    (store, a) => {
      const name = store.name(a.project);
      checkName('component', a.id);
      checkProps(a.props);
      const lib = loadLibrary(store, name);
      if (lib.components[a.id]) fail(`component ${a.id} exists; use update_component`);
      const def = { title: a.title ?? a.id, description: a.description ?? '', file: `library/${a.id}.html`, props: a.props ?? {} };
      render(a.id, def, a.html, {}); // refuses a template that names a prop it does not have
      mkdirSync(dirname(store.inside(name, def.file)), { recursive: true });
      writeFileSync(store.inside(name, def.file), `${a.html.trim()}\n`);
      lib.components[a.id] = def;
      saveLibrary(store, name, lib);
      return { id: a.id };
    },
  ),

  update_component: cmd(
    'Change a component. Every frame that uses it is rewritten at once.',
    { project, id: t.str('component id'), title: t.str('title'), description: t.str('description'), html: t.str('the new fragment'), props: propSchema },
    ['id'],
    (store, a) => {
      const name = store.name(a.project);
      const lib = loadLibrary(store, name);
      const def = lib.components[a.id];
      if (!def) fail(`no component ${a.id}`);
      if (a.props) checkProps(a.props);
      const next = { ...def, ...(a.title && { title: a.title }), ...(a.description != null && { description: a.description }), ...(a.props && { props: a.props }) };
      const template = a.html ?? readFileSync(store.inside(name, def.file), 'utf8');
      render(a.id, next, template, {});
      if (a.html != null) writeFileSync(store.inside(name, def.file), `${a.html.trim()}\n`);
      lib.components[a.id] = next;
      saveLibrary(store, name, lib);
      return { id: a.id, ...afterEdit(store, name) };
    },
  ),

  rename_component: cmd(
    'Give a component a new id (and optionally a new title) everywhere: the registry, its template, and every instance in every frame. A library sheet frame is not renamed: regenerate it with component_sheet.',
    { project, id: t.str('current id'), to: t.str('new id'), title: t.str('new title; keeps the old one when omitted') },
    ['id', 'to'],
    (store, a) => {
      const name = store.name(a.project);
      checkName('component', a.to);
      const lib = loadLibrary(store, name);
      const def = lib.components[a.id];
      if (!def) fail(`no component ${a.id}`);
      if (lib.components[a.to]) fail(`component ${a.to} exists`);
      const next = { ...def, title: a.title ?? def.title, file: `library/${a.to}.html` };
      renameSync(store.inside(name, def.file), store.inside(name, next.file));
      delete lib.components[a.id];
      lib.components[a.to] = next;
      saveLibrary(store, name, lib);
      let renamed = 0;
      for (const file of htmlFiles(store, name)) {
        const path = store.inside(name, file);
        const text = readFileSync(path, 'utf8');
        const out = renameInHtml(text, a.id, a.to);
        if (out !== text) {
          writeFileSync(path, out);
          renamed += regionsOf(text).filter((r) => r.id === a.id).length;
        }
      }
      return { id: a.to, renamed, ...afterEdit(store, name) };
    },
  ),

  remove_component: cmd('Remove a component. Frames that use it keep their markup (the references are detached).', { project, id: t.str('component id') }, ['id'], (store, a) => {
    const name = store.name(a.project);
    const lib = loadLibrary(store, name);
    const def = lib.components[a.id];
    if (!def) fail(`no component ${a.id}`);
    let detached = 0;
    for (const file of htmlFiles(store, name)) {
      const path = store.inside(name, file);
      const text = readFileSync(path, 'utf8');
      if (!text.includes('fr:component')) continue;
      const out = detach(text, a.id);
      if (out !== text) {
        detached += regionsOf(text).filter((r) => r.id === a.id).length;
        writeFileSync(path, out);
      }
    }
    delete lib.components[a.id];
    saveLibrary(store, name, lib);
    if (existsSync(store.inside(name, def.file))) unlinkSync(store.inside(name, def.file));
    return { removed: a.id, detached };
  }),

  use_component: cmd(
    'Put a component into a frame: replace an exact snippet of the frame\'s html with an instance, or insert one before a snippet. The snippet must appear once.',
    { project, file: t.str('the frame html path inside the project'), component: t.str('component id'), props: { type: 'object', description: '{ prop: value }; anchor and id are always allowed' }, replace: t.str('exact html to replace'), before: t.str('exact html to insert before') },
    ['file', 'component'],
    (store, a) => {
      const name = store.name(a.project);
      const lib = loadLibrary(store, name);
      const def = lib.components[a.component];
      if (!def) fail(`no component ${a.component}`);
      const at = a.replace ?? a.before;
      if (!at) fail('say where: replace (an exact snippet) or before (an exact snippet)');
      const path = store.inside(name, a.file);
      const text = readFileSync(path, 'utf8');
      const first = text.indexOf(at);
      if (first < 0) fail(`${a.file} does not contain that snippet`);
      if (text.indexOf(at, first + 1) >= 0) fail('that snippet appears more than once; make it longer');
      const props = Object.fromEntries(Object.entries(a.props ?? {}).map(([k, v]) => [k, String(v)]));
      const html = render(a.component, def, readFileSync(store.inside(name, def.file), 'utf8'), props);
      const instance = `${marker(a.component, props)}${html}<!-- /fr:component -->`;
      writeFileSync(path, text.slice(0, first) + instance + (a.replace != null ? '' : at) + text.slice(first + at.length));
      return { file: a.file, component: a.component };
    },
  ),

  component_sheet: cmd(
    'Write the page that shows a component in all its variants (one instance per enum value, or one when it has none) as components/lib-<id>.html, made of instances, so it updates with the definition. Put it on the design-system page with add_item.',
    { project, id: t.str('component id') },
    ['id'],
    (store, a) => {
      const name = store.name(a.project);
      const def = loadLibrary(store, name).components[a.id];
      if (!def) fail(`no component ${a.id}`);
      const enums = Object.entries(def.props ?? {}).filter(([, spec]) => spec.type === 'enum');
      const [prop, spec] = enums.find(([, s]) => s.search) ?? enums[0] ?? [];
      const label = def.props?.label ? 'label' : null;
      const states = prop ? ['', ...Object.keys(spec.values)].filter((v) => v || !spec.search) : [''];
      const instances = states.map((value) => {
        const props = {};
        if (prop && value) props[prop] = value;
        if (label) props.label = value ? value[0].toUpperCase() + value.slice(1) : 'Default';
        const one = `${marker(a.id, props)}<!-- /fr:component -->`;
        // a component that positions itself against a phone (a bar) is shown inside a shell of the height its definition names
        return def.sheet?.height ? `<div class="gal__shell" style="height:${def.sheet.height}px">${one}</div>` : one;
      });
      const file = `components/lib-${a.id}.html`;
      mkdirSync(store.inside(name, 'components'), { recursive: true });
      writeFileSync(
        store.inside(name, file),
        `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${def.title ?? a.id}, all variants</title>\n  <link rel="stylesheet" href="../tokens.css">\n  <link rel="stylesheet" href="../base.css">\n  <link rel="stylesheet" href="../app.css">\n  <link rel="stylesheet" href="../board.css">\n</head>\n<body class="embed-doc">\n<script src="../icons.js"></script>\n<!-- Every variant of ${a.id}, as instances: edit the component and this page follows. -->\n<main class="spec">\n<div class="gal__stack">\n${instances.join('\n')}\n</div>\n</main>\n</body>\n</html>\n`,
      );
      const synced = sync(store, name);
      return { file, variants: states.length, synced: synced.changed.length };
    },
  ),

  detach_component: cmd('Turn instances back into plain markup: all of one component, or every component, in a file.', { project, file: t.str('frame html path'), component: t.str('component id; omit for all') }, ['file'], (store, a) => {
    const name = store.name(a.project);
    const path = store.inside(name, a.file);
    const text = readFileSync(path, 'utf8');
    const out = detach(text, a.component);
    const detached = regionsOf(text).filter((r) => !a.component || r.id === a.component).length;
    if (out !== text) writeFileSync(path, out);
    return { file: a.file, detached };
  }),

  sync_components: cmd('Rewrite every instance in every frame from its definition. Runs by itself when the library changes; call it after writing a marker by hand.', { project }, [], (store, a) => sync(store, store.name(a.project))),

  find_candidates: cmd(
    'Markup that repeats across the frames and is not a component yet, with counts, the modifier classes seen and the extra classes. Each is a candidate for promote_component.',
    { project, min: t.num('fewest copies to list; default 3') },
    [],
    (store, a) => scan(store, store.name(a.project), { min: a.min ?? 3 }),
  ),

  convert_copies: cmd(
    'Turn the plain copies still left of an existing component into references, using its own definition. Run it after the definition learned a prop, or after a frame was written by hand. A copy converts only if the component draws it exactly as it is.',
    { project, id: t.str('component id') },
    ['id'],
    (store, a) => adopt(store, store.name(a.project), a.id),
  ),

  promote_component: cmd(
    'Make a repeated element a component. Its text becomes a label prop, a trailing svg an icon prop; the modifier classes you name become a variant enum and flags. Each copy becomes a reference only if the component draws it exactly as it is now; the rest are reported and left alone.',
    {
      project,
      id: t.str('new component id'),
      tag: t.str('the element, e.g. button'),
      block: t.str('its root class, e.g. btn'),
      title: t.str('title'),
      description: t.str('description'),
      variants: { type: 'array', items: { type: 'string' }, description: 'modifier names that are mutually exclusive, e.g. ["primary","danger"] for btn--primary, btn--danger' },
      flags: { type: 'array', items: { type: 'string' }, description: 'modifier names that switch on and off, e.g. ["block"]' },
      convert: t.bool('replace the matching copies with references (default true); false only writes the definition'),
    },
    ['id', 'tag', 'block'],
    (store, a) => promote(store, store.name(a.project), { ...a, convert: a.convert !== false }),
  ),
};
