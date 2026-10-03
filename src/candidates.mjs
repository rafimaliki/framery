// Markup that is not a component yet, and the step that makes it one.
//
// scan() lists the elements that repeat across the frames (the same tag and root class, again and again),
// outside any component region. promote() turns one such family into a library component, derives each
// copy's props from its own markup, and replaces a copy with a reference only when the component would
// render it exactly: a copy that differs stays as it is and is reported, so promoting never changes
// what a frame looks like.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fail } from './store.mjs';
import { RESERVED, htmlFiles, loadLibrary, region, regionsOf, render, saveLibrary, templateOf, unesc } from './library.mjs';

const START = /<([a-z][\w-]*)\b([^>]*)>/g;
const ATTRS = /([\w:-]+)(?:="([^"]*)")?/g;
const PASS = new Set(['class', 'type', 'disabled', 'data-anchor', 'id', 'style']); // attributes an instance can carry

const parseAttrs = (text) => Object.fromEntries([...text.matchAll(ATTRS)].map((m) => [m[1], m[2] ?? '']));
const isBlock = (token) => !token.includes('__') && !token.includes('--') && !/^(is|has)-/.test(token);

// The element that opens at `start`, up to its matching close: [end index, inner html].
function elementEnd(text, tag, from) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  re.lastIndex = from;
  let depth = 1;
  for (let m; (m = re.exec(text)); ) {
    if (m[1]) depth--;
    else if (!m[0].endsWith('/>')) depth++;
    if (!depth) return m.index + m[0].length;
  }
  return -1;
}

// Every element in a file that has a class and is not inside a component region.
function elements(text) {
  const skip = regionsOf(text);
  const inside = (i) => skip.some((r) => i >= r.start && i < r.end);
  const out = [];
  for (const m of text.matchAll(START)) {
    const [, tag, attrs] = m;
    if (inside(m.index) || /^(script|style|svg|path|use|link|meta|input|img|br)$/.test(tag)) continue;
    const cls = parseAttrs(attrs).class;
    if (!cls) continue;
    const classes = cls.split(/\s+/).filter(Boolean);
    const end = elementEnd(text, tag, m.index + m[0].length);
    if (end < 0) continue;
    out.push({ tag, attrs: parseAttrs(attrs), classes, start: m.index, end, html: text.slice(m.index, end) });
  }
  return out;
}

export function scan(store, project, { min = 3 } = {}) {
  const groups = new Map();
  for (const file of htmlFiles(store, project)) {
    const text = readFileSync(store.inside(project, file), 'utf8');
    for (const el of elements(text)) {
      const block = el.classes.find(isBlock);
      if (!block || el.classes[0] !== block) continue;
      const key = `${el.tag}.${block}`;
      const g = groups.get(key) ?? { key, tag: el.tag, block, count: 0, files: new Set(), modifiers: {}, extras: {} };
      g.count++;
      g.files.add(file);
      for (const c of el.classes.slice(1)) {
        const bucket = c.startsWith(`${block}--`) ? g.modifiers : g.extras;
        bucket[c] = (bucket[c] ?? 0) + 1;
      }
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .filter((g) => g.count >= min)
    .sort((a, b) => b.count - a.count)
    .slice(0, 40)
    .map((g) => ({ ...g, files: g.files.size }));
}

// ---- promote ---------------------------------------------------------------------------------------
function analyse(el, block, variants, flags, fixed = []) {
  const { attrs, classes } = el;
  // the template's own root attributes (aria-label on a nav, say) are part of the component
  for (const name of Object.keys(attrs)) if (!PASS.has(name) && !fixed.includes(name)) return { reason: `has the attribute ${name}` };
  const modifiers = classes.filter((c) => c.startsWith(`${block}--`)).map((c) => c.slice(block.length + 2));
  const chosen = modifiers.filter((m) => variants.includes(m));
  if (chosen.length > 1) return { reason: `has two variants (${chosen.join(', ')})` };
  const props = {};
  if (chosen[0]) props.variant = chosen[0];
  for (const m of modifiers) if (flags.includes(m)) props[m] = 'true';
  const rest = classes.filter((c) => c !== block && !c.startsWith(`${block}--`));
  const stray = modifiers.filter((m) => !variants.includes(m) && !flags.includes(m));
  const extra = [...rest, ...stray.map((m) => `${block}--${m}`)].join(' ');
  if (extra) props.extra = extra;
  if ('disabled' in attrs) props.disabled = 'true';
  if (attrs['data-anchor']) props.anchor = attrs['data-anchor'];
  if (attrs.id) props.id = attrs.id;
  if (attrs.style) props.style = unesc(attrs.style);
  const inner = el.html.slice(el.html.indexOf('>') + 1, el.html.lastIndexOf('</'));
  return { props, inner, type: attrs.type };
}

function innerProps(inner) {
  const text = inner.trim();
  if (!/</.test(text)) return { label: unesc(text) };
  const m = text.match(/^([^<]*?)\s*(<svg[\s\S]*<\/svg>)\s*$/);
  return m ? { label: unesc(m[1]), icon: m[2] } : { content: text };
}

// Tags and whitespace compared as a browser would care about them, not as the file spells them.
function normal(html) {
  return html
    .replace(/ data-fr-component="[^"]*"/, '')
    .replace(/<([a-z][\w-]*)\b([^>]*)>/g, (_m, tag, attrs) => {
      const a = parseAttrs(attrs);
      if (a.class) a.class = a.class.split(/\s+/).filter(Boolean).sort().join(' ');
      const body = Object.keys(a).sort().map((k) => (a[k] === '' && k !== 'class' ? k : `${k}="${a[k]}"`)).join(' ');
      return `<${tag}${body ? ' ' + body : ''}>`;
    })
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
}

export function promote(store, project, { id, tag, block, title, description, variants = [], flags = [], convert = true }) {
  const lib = loadLibrary(store, project);
  if (lib.components[id]) fail(`component ${id} exists`);
  const files = htmlFiles(store, project).map((file) => ({ file, text: readFileSync(store.inside(project, file), 'utf8') }));
  const found = [];
  for (const f of files) for (const el of elements(f.text)) if (el.tag === tag && el.classes[0] === block) found.push({ ...el, file: f.file });
  if (!found.length) fail(`no <${tag} class="${block} …"> outside components`);

  const analysed = found.map((el) => ({ el, ...analyse(el, block, variants, flags) }));
  const ok = analysed.filter((a) => a.props);
  if (!ok.length) fail(`none of the ${found.length} copies can be a component: ${analysed[0].reason}`);

  const base = ok[0];
  const shapes = ok.map((a) => innerProps(a.inner));
  const has = (key) => shapes.some((s) => key in s);
  const first = (key) => shapes.find((s) => key in s)[key];
  const props = {};
  if (has('label')) props.label = { type: 'text', default: first('label') };
  if (has('icon')) props.icon = { type: 'html', default: first('icon') };
  if (has('content')) props.content = { type: 'html', default: first('content') };
  if (variants.length) props.variant = { type: 'enum', values: Object.fromEntries(variants.map((v) => [v, `${block}--${v}`])), default: '' };
  for (const flag of flags) props[flag] = { type: 'flag', output: `${block}--${flag}` };
  props.extra = { type: 'text', default: '' };
  if (ok.some((a) => 'disabled' in a.el.attrs)) props.disabled = { type: 'flag', output: 'disabled' };
  const body = ['label', 'icon', 'content'].filter(has).map((k) => `{{${k}}}`).join('');
  const classAttr = [block, variants.length && '{{variant}}', ...flags.map((f) => `{{${f}}}`), '{{extra}}'].filter(Boolean).join(' ');
  const typeAttr = base.type ? ` type="${base.type}"` : '';
  const template = `<${tag} class="${classAttr}"${typeAttr}${props.disabled ? ' {{disabled}}' : ''}>${body}</${tag}>\n`;
  const def = { title: title ?? id, description: description ?? '', file: `library/${id}.html`, props };

  mkdirSync(store.inside(project, 'library'), { recursive: true });
  writeFileSync(store.inside(project, def.file), template);
  lib.components[id] = def;
  saveLibrary(store, project, lib);

  const result = convertCopies(store, project, { id, def, template, files, analysed, baseType: base.type, convert });
  return { id, copies: found.length, ...result, props: Object.keys(props) };
}

// An enum a copy's classes cannot reveal (which tab is active) is found by trying each value in turn.
function searchEnums(id, def, template, wanted, original) {
  for (const [name, spec] of Object.entries(def.props)) {
    if (spec.type !== 'enum' || !spec.search) continue;
    for (const key of Object.keys(spec.values)) {
      const trial = { ...wanted, [name]: key };
      const drawn = render(id, def, template, trial);
      if (normal(drawn) === normal(original)) return { wanted: trial, drawn };
    }
  }
  return null;
}

// Each copy becomes a reference only when the component would draw it exactly as it is drawn now.
function convertCopies(store, project, { id, def, template, files, analysed, baseType, convert }) {
  const props = def.props;
  const kept = [];
  const replace = new Map(); // file -> [{ start, end, text }]
  for (const a of analysed) {
    if (!a.props) {
      kept.push({ file: a.el.file, reason: a.reason });
      continue;
    }
    if (a.type !== baseType) {
      kept.push({ file: a.el.file, reason: 'its type differs' });
      continue;
    }
    const given = { ...a.props, ...innerProps(a.inner) };
    for (const key of ['label', 'icon', 'content']) if (key in props && !(key in given)) given[key] = ''; // absent in this copy: say so
    let wanted = {};
    for (const [k, v] of Object.entries(given)) if (k in props || RESERVED.includes(k)) wanted[k] = v;
    let drawn;
    try {
      drawn = render(id, def, template, wanted);
    } catch (error) {
      kept.push({ file: a.el.file, reason: error.message });
      continue;
    }
    if (normal(drawn) !== normal(a.el.html)) {
      const hit = searchEnums(id, def, template, wanted, a.el.html);
      if (!hit) {
        kept.push({ file: a.el.file, reason: 'it differs from what the component draws' });
        continue;
      }
      ({ wanted, drawn } = hit);
    }
    const list = replace.get(a.el.file) ?? [];
    list.push({ start: a.el.start, end: a.el.end, text: region(id, wanted, drawn) });
    replace.set(a.el.file, list);
  }
  let converted = 0;
  if (convert) {
    for (const [file, list] of replace) {
      let text = files.find((f) => f.file === file).text;
      for (const r of list.sort((x, y) => y.start - x.start)) text = text.slice(0, r.start) + r.text + text.slice(r.end);
      writeFileSync(store.inside(project, file), text);
      converted += list.length;
    }
  }
  return { converted, kept };
}

// Convert the plain copies that are still left for a component that already exists: after its
// definition learned a new prop, for instance, or after a frame was written by hand.
export function adopt(store, project, id) {
  const lib = loadLibrary(store, project);
  const def = lib.components[id];
  if (!def) fail(`no component ${id}`);
  const template = templateOf(store, project, def);
  const tag = template.match(/^<([a-z][\w-]*)/)?.[1];
  const block = template.match(/class="([^"\s{]+)/)?.[1];
  if (!tag || !block) fail(`${id}: its template must start with an element that has a root class`);
  const variants = Object.keys(def.props.variant?.values ?? {});
  const flags = Object.entries(def.props).filter(([key, spec]) => spec.type === 'flag' && key !== 'disabled').map(([key]) => key);
  const files = htmlFiles(store, project).map((file) => ({ file, text: readFileSync(store.inside(project, file), 'utf8') }));
  const found = [];
  for (const f of files) for (const el of elements(f.text)) if (el.tag === tag && el.classes[0] === block) found.push({ ...el, file: f.file });
  const root = parseAttrs(template.match(/^<[a-z][\w-]*([^>]*)>/)[1]);
  const fixed = Object.keys(root).filter((name) => name !== 'class');
  const analysed = found.map((el) => ({ el, ...analyse(el, block, variants, flags, fixed) }));
  const baseType = root.type;
  return { id, copies: found.length, ...convertCopies(store, project, { id, def, template, files, analysed, baseType, convert: true }) };
}
