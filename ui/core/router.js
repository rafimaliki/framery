// The address bar is the app's route: #/<project>/<page>[/<item>]. A link an agent hands over opens
// the right page and focuses the right item.

export const parse = (hash = location.hash) => {
  const [project, page, id] = hash.replace(/^#\/?/, '').split('/').map((part) => decodeURIComponent(part || ''));
  return { project: project || null, page: page || null, id: id || null };
};

export const format = ({ project, page, id }) => '#/' + [project, page, id].filter(Boolean).map(encodeURIComponent).join('/');

export function navigate(route, { replace = false } = {}) {
  const hash = format(route);
  if (hash === location.hash) return;
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
}

export const onRoute = (fn) => addEventListener('hashchange', () => fn(parse()));
