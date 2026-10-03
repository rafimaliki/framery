// The component library: html fragments with props, kept in the project, and the marked regions that
// refer to them from frames.
//
//   library.json            { components: { <id>: { title, description, file, props } } }
//   library/<id>.html       the fragment, with {{prop}} placeholders
//
// A frame uses a component through a region it can be read and opened as plain html:
//
//   <!-- fr:component button variant="primary" label="Save" -->…generated html…<!-- /fr:component -->
//
// The html between the markers is generated from the definition. Editing a definition rewrites every
// region that uses it (sync), so the frames stay valid, standalone html and nothing expands in a browser.
//
// A prop is { type: 'text' | 'html' | 'enum' | 'flag', default?, values?, output? }:
//   text  escaped text            html  trusted markup (an icon)
//   enum  one of `values`, each mapped to the class string it adds; a template can also test one with
//         {{prop==value?output}} or {{prop==value?output:other}}, and `search: true` lets convert_copies try each value to match a copy
//   flag  true or absent; true inserts `output` (a class, or an attribute such as "disabled")
// `anchor`, `id` and `style` are reserved on every instance: they become data-anchor, id and style on the root.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fail, readJson, writeJson } from './store.mjs';

export const RESERVED = ['anchor', 'id', 'style'];
const FILE = 'library.json';
const REGION = /<!--\s*fr:component\s+([\w-]+)((?:\s+[\w-]+="[^"]*")*)\s*-->([\s\S]*?)<!--\s*\/fr:component\s*-->/g;
const ATTR = /([\w-]+)="([^"]*)"/g;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);
export const unesc = (s) => s.replace(/&quot;|&lt;|&gt;|&amp;/g, (m) => ({ '&quot;': '"', '&lt;': '<', '&gt;': '>', '&amp;': '&' })[m]);

// ---- the registry ----------------------------------------------------------------------------------
export function loadLibrary(store, project) {
  const file = store.inside(project, FILE);
  const lib = existsSync(file) ? readJson(file) : { components: {} };
  lib.components ??= {};
  return lib;
}

export const saveLibrary = (store, project, lib) => writeJson(store.inside(project, FILE), lib);

export function templateOf(store, project, def) {
  const file = store.inside(project, def.file);
  if (!existsSync(file)) fail(`component file ${def.file} is missing`);
  return readFileSync(file, 'utf8');
}

// ---- rendering -------------------------------------------------------------------------------------
export function render(id, def, template, props = {}) {
  const known = Object.keys(def.props ?? {});
  for (const key of Object.keys(props)) {
    if (!known.includes(key) && !RESERVED.includes(key)) fail(`${id}: no prop "${key}"; have ${[...known, ...RESERVED].join(', ')}`);
  }
  const values = {};
  for (const [name, spec] of Object.entries(def.props ?? {})) {
    const value = props[name] ?? spec.default;
    if (spec.type === 'text') values[name] = esc(value ?? '');
    else if (spec.type === 'html') values[name] = value ?? '';
    else if (spec.type === 'flag') values[name] = String(value) === 'true' ? spec.output : '';
    else if (spec.type === 'enum') {
      if (!value) values[name] = '';
      else if (!(value in spec.values)) fail(`${id}.${name}: "${value}" is not one of ${Object.keys(spec.values).join(', ')}`);
      else values[name] = spec.values[value];
    } else fail(`${id}.${name}: unknown prop type ${spec.type}`);
  }
  // {{prop==value?output}} writes `output` only when the prop equals value (which tab is active, say);
  // {{prop==value?output:other}} writes `other` otherwise (aria-selected="true" or "false").
  const chosen = (name) => props[name] ?? def.props?.[name]?.default ?? '';
  let html = template
    .trim()
    .replace(/\{\{(\w+)==([\w-]+)\?([^}:]*)(?::([^}]*))?\}\}/g, (_m, name, value, out, otherwise = '') => (name in (def.props ?? {}) ? (chosen(name) === value ? out : otherwise) : fail(`${id}: the template tests {{${name}==…}}, which is not a prop`)))
    .replace(/\{\{(\w+)\}\}/g,(_m, key) => (key in values ? values[key] : fail(`${id}: the template uses {{${key}}}, which is not a prop`)))
    .replace(/<[a-zA-Z][^>]*>/g, (tag) => tag.replace(/class="([^"]*)"/g, (_c, cls) => `class="${cls.trim().replace(/\s+/g, ' ')}"`).replace(/\s{2,}/g, ' ').replace(/\s+>/, '>'));
  const root = ` data-fr-component="${id}"${props.anchor ? ` data-anchor="${esc(props.anchor)}"` : ''}${props.id ? ` id="${esc(props.id)}"` : ''}${props.style ? ` style="${esc(props.style)}"` : ''}`;
  return html.replace(/^<([a-zA-Z][\w-]*)/, `<$1${root}`);
}

export const marker = (id, props) => `<!-- fr:component ${id}${Object.entries(props).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')} -->`;
export const region = (id, props, html) => `${marker(id, props)}${html}<!-- /fr:component -->`;

// ---- reading and rewriting frames -------------------------------------------------------------------
export const parseProps = (attrs) => Object.fromEntries([...attrs.matchAll(ATTR)].map((m) => [m[1], unesc(m[2])]));

export function regionsOf(text) {
  return [...text.matchAll(REGION)].map((m) => ({ id: m[1], props: parseProps(m[2]), start: m.index, end: m.index + m[0].length }));
}

export function expand(text, lib, templateFor) {
  const problems = [];
  let count = 0;
  const out = text.replace(REGION, (whole, id, attrs) => {
    const def = lib.components[id];
    if (!def) {
      problems.push(`unknown component ${id}`);
      return whole;
    }
    try {
      const props = parseProps(attrs);
      count++;
      return region(id, props, render(id, def, templateFor(id, def), props));
    } catch (error) {
      problems.push(error.message);
      return whole;
    }
  });
  return { text: out, count, problems };
}

export const detach = (text, id) => text.replace(REGION, (whole, cid, _attrs, inner) => (!id || id === cid ? inner : whole));

export function htmlFiles(store, project) {
  return readdirSync(store.dir(project), { recursive: true })
    .map((f) => f.split(sep).join('/'))
    .filter((f) => f.endsWith('.html') && !/^(library|\.cache)\//.test(f));
}

// Rewrite every region in the project from its definition; only files that change are written.
export function sync(store, project) {
  const lib = loadLibrary(store, project);
  const cache = new Map();
  const templateFor = (id, def) => (cache.has(id) ? cache.get(id) : cache.set(id, templateOf(store, project, def)).get(id));
  const changed = [];
  const problems = [];
  for (const file of htmlFiles(store, project)) {
    const path = store.inside(project, file);
    const before = readFileSync(path, 'utf8');
    if (!before.includes('fr:component')) continue;
    const result = expand(before, lib, templateFor);
    problems.push(...result.problems.map((p) => `${file}: ${p}`));
    if (result.text !== before) {
      writeFileSync(path, result.text);
      changed.push(file);
    }
  }
  return { changed, problems };
}

// Where each component is used: { <id>: { total, files: { <file>: n }, items: { <file>: [{ seq, props }] } } }.
export function usage(store, project) {
  const out = {};
  for (const file of htmlFiles(store, project)) {
    const text = readFileSync(store.inside(project, file), 'utf8');
    if (!text.includes('fr:component')) continue;
    regionsOf(text).forEach(({ id, props }, seq) => {
      out[id] ??= { total: 0, files: {}, items: {} };
      out[id].total++;
      out[id].files[file] = (out[id].files[file] ?? 0) + 1;
      (out[id].items[file] ??= []).push({ seq, props }); // seq: its place among every instance in the file
    });
  }
  return out;
}

// Rename a component everywhere its name is written: the registry, its template, every marker.
export function renameInHtml(text, from, to) {
  const name = from.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  return text.replace(new RegExp(String.raw`(<!--\s*fr:component\s+)` + name + String.raw`(?=[\s>])`, 'g'), `$1${to}`);
}
