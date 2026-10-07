// Values typed into a project's css and frames that should be its design tokens: what check_tokens reports
// and, with fix, rewrites. Colours always count: one that equals a token is that token, any other is a value
// outside the system. A size counts only when it equals a token whose name fits the property (14px is
// --radius in border-radius, not in padding). The tokens file itself and the generated component regions
// in frames are left alone: a region is rewritten from its library template, which is checked instead.

const COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\brgba?\([^)]*\)/gi;
const REGION = /<!--\s*fr:component\b[\s\S]*?<!--\s*\/fr:component\s*-->/g;
const FAMILIES = [
  [/^border(-[a-z]+)*-radius$/, /radius|round|corner/],
  [/^font-size$/, /font|text|size|type/],
  [/^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?$/, /space|gap|pad|margin|inset/],
];

// a colour as [r, g, b, a] (0-255, alpha 0-1), so #fff, #ffffff and rgb(255 255 255) are one value
function rgba(text) {
  const t = text.trim().toLowerCase();
  if (t.startsWith('#')) {
    const hex = t.length <= 5 ? [...t.slice(1)].map((c) => c + c).join('') : t.slice(1);
    const n = hex.match(/../g).map((h) => parseInt(h, 16));
    return [n[0], n[1], n[2], n.length > 3 ? Math.round((n[3] / 255) * 100) / 100 : 1].join(',');
  }
  const m = t.match(/^rgba?\(([^)]*)\)$/);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const n = parts.slice(0, 3).map((p) => (p.endsWith('%') ? Math.round(parseFloat(p) * 2.55) : Math.round(parseFloat(p))));
  const a = parts[3] ? (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
  return [...n, Math.round(a * 100) / 100].join(',');
}

// Run `edit` over the css in a file: all of a css file; the style attributes and <style> blocks of html,
// outside generated component regions. `edit(css)` returns the css, changed or not.
function overCss(file, edit) {
  if (file.path.endsWith('.css')) return edit(file.text);
  const inStyles = (html) => html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, a, css, b) => a + edit(css) + b).replace(/(\sstyle=")([^"]*)(")/gi, (_, a, css, b) => a + edit(css) + b);
  let out = '';
  let last = 0;
  for (const m of file.text.matchAll(REGION)) {
    out += inStyles(file.text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + inStyles(file.text.slice(last));
}

export function checkTokens(files, tokenList, { fix = false } = {}) {
  const byColor = new Map();
  for (const t of tokenList) {
    const c = /^(#|rgb)/i.test(t.value) ? rgba(t.value) : null;
    if (c) byColor.set(c, [...(byColor.get(c) ?? []), t.name]);
  }
  const found = new Map(); // "path|literal|token" -> count
  const note = (path, literal, token) => {
    const k = `${path}|${literal}|${token ?? ''}`;
    found.set(k, (found.get(k) ?? 0) + 1);
  };
  const changed = new Map();
  for (const file of files) {
    const after = overCss(file, (css) =>
      css.replace(/([a-z-]+)(\s*:\s*)([^;{}]+)/gi, (decl, prop, colon, value) => {
        if (prop.startsWith('--')) return decl; // a custom property of its own: not ours to judge
        let next = value.replace(COLOR, (literal) => {
          const names = byColor.get(rgba(literal));
          note(file.path, literal, names?.join(' or '));
          // the same value under two names is a choice of meaning: say both, rewrite neither
          return names?.length === 1 && fix ? `var(${names[0]})` : literal;
        });
        const family = FAMILIES.find(([props]) => props.test(prop.toLowerCase()));
        const token = family && tokenList.find((t) => family[1].test(t.name) && t.value.trim() === next.trim());
        if (token) {
          note(file.path, next.trim(), token.name);
          if (fix) next = next.replace(next.trim(), `var(${token.name})`);
        }
        return prop + colon + next;
      }),
    );
    if (fix && after !== file.text) changed.set(file.path, after);
  }
  const problems = [...found].map(([k, count]) => {
    const [path, literal, token] = k.split('|');
    const times = count > 1 ? ` (${count} places)` : '';
    return token
      ? { file: path, literal, token, problem: `${path}: ${literal} is ${token}${times}: use ${token.split(' or ').map((n) => `var(${n})`).join(' or ')}` }
      : { file: path, literal, problem: `${path}: ${literal} is not a token${times}: use one, or add it to the tokens if the design needs it` };
  });
  return { problems, changed };
}
