// Whether a page's flows make sense, from the arrows alone: what check_flow reports. A flow is a group
// whose items have arrows, or the loose items at the top of the page that have some.

import { refItem } from './layout.mjs';

export function checkFlow(page) {
  const items = page.items ?? [];
  const arrows = page.arrows ?? [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const outOf = (id) => arrows.filter((a) => refItem(a.from) === id);
  const into = (id) => arrows.filter((a) => refItem(a.to) === id);
  const wired = (id) => outOf(id).length + into(id).length > 0;
  const problems = [];
  const say = (item, problem) => problems.push({ item, problem });

  // the flows: each group's own items (nested groups are flows of their own), and the page's loose items
  const flows = new Map([[null, []]]);
  for (const i of items) if (i.type === 'group') flows.set(i.id, []);
  for (const i of items) if (i.type !== 'group') flows.get(flows.has(i.parent) ? i.parent : null).push(i);
  for (const [group, members] of flows) {
    if (!members.some((m) => wired(m.id))) continue; // a gallery or a spec sheet, not a flow
    const name = group ? `group ${group}` : 'the page';
    const starts = members.filter((m) => outOf(m.id).length && !into(m.id).length);
    if (starts.length > 1) say(group, `${name} has ${starts.length} starts (${starts.map((s) => s.id).join(', ')}): a flow has one; connect the others or move them to a group of their own`);
    if (starts.length === 1) {
      const seen = new Set([starts[0].id]);
      for (const queue = [starts[0].id]; queue.length; ) for (const a of outOf(queue.shift())) if (!seen.has(refItem(a.to))) seen.add(refItem(a.to)) && queue.push(refItem(a.to));
      for (const m of members) if (!seen.has(m.id)) say(m.id, `nothing leads to ${m.id} from the start of ${name} (${starts[0].id})`);
    }
  }

  for (const item of items) {
    if (item.type === 'node' && item.shape === 'diamond') {
      const answers = outOf(item.id);
      if (answers.length < 2) say(item.id, `diamond ${item.id} has ${answers.length} answer${answers.length === 1 ? '' : 's'}: a question needs two or more`);
      for (const a of answers.filter((a) => !a.label)) say(item.id, `the answer ${a.id} from diamond ${item.id} has no label: say which answer it is`);
    }
    if (item.type !== 'frame' || !wired(item.id)) continue;
    if (!outOf(item.id).length && into(item.id).length && !item.end) say(item.id, `${item.id} is a dead end: connect it onward, or mark it as an ending with update_item {patch: {end: true}}`);
    if (!item.description) say(item.id, `${item.id} has no description: say what it is and the rule it keeps`);
  }
  return problems;
}
