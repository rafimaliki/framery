// The studio server, as functions. Nothing else in the UI builds a URL to the API.

async function json(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${url}`);
  return body;
}

export const api = {
  projects: () => json('/api/projects'),
  version: () => json('/api/version').then((r) => r.version),
  project: (name) => json(`/p/${name}/project.json`),
  components: (name) => json(`/api/components?project=${encodeURIComponent(name)}`).catch(() => []),
  page: (name, id) => json(`/p/${name}/pages/${id}.json`),
  async command(name, args = {}) {
    const body = await json('/api/cmd', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, args }) });
    return body.result;
  },
  exportUrl: (params) => `/api/export?${new URLSearchParams(params)}`,
  file: (project, path, rev = 0) => `/p/${project}/${path}${rev ? `?v=${rev}` : ''}`,
  preview: (project, id, rev) => `/p/${project}/.cache/frames/${id}.webp${rev ? `?v=${rev}` : ''}`,
  anchors: (project, id, rev) => json(`/p/${project}/.cache/anchors/${id}.json${rev ? `?v=${rev}` : ''}`),
};
