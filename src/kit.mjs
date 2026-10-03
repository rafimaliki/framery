// The small vocabulary every command file is written in: JSON-schema pieces and the shape of a
// command. commands.mjs and the component commands both build their tables from it.

export const t = {
  str: (description) => ({ type: 'string', description }),
  num: (description) => ({ type: 'number', description }),
  bool: (description) => ({ type: 'boolean', description }),
  one: (values, description) => ({ type: 'string', enum: values, description }),
  ids: { type: 'array', items: { type: 'string' }, description: 'item ids' },
};

export const project = t.str('project name; optional when there is only one');
export const where = { project, page: t.str('page id; optional when the project has one page') };

export const cmd = (description, props, required, run) => ({
  description,
  input: { type: 'object', properties: props, required, additionalProperties: false },
  run,
});
