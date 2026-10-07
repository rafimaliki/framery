// A demo project for developing the studio: `npm run demo` rebuilds framery/pocket (the gitignored scratch
// folder) and serves it. Every item goes through the tools, so the seed itself checks validation.
//
//   onboarding     a phone flow with a branch, a failure state and anchored arrows
//   app            phone, tablet and desktop screens in three groups
//   design-system  document frames: colors, type, controls
//   plan           a table whose rows link to the screens
//   stress         40 frames in five stacked row groups: export caps, layer-list animations, zoomed-out captions

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/commands.mjs';
import { FORMAT, Store, writeJson } from '../src/store.mjs';

const root = join(fileURLToPath(new URL('..', import.meta.url)), 'framery');
const project = 'pocket';
const base = join(root, project);
rmSync(base, { recursive: true, force: true });
mkdirSync(join(base, 'pages'), { recursive: true });
writeJson(join(base, 'project.json'), { format: FORMAT, title: 'Pocket', tokens: 'tokens.css', pages: [] });

const file = (path, text) => {
  mkdirSync(dirname(join(base, path)), { recursive: true });
  writeFileSync(join(base, path), text);
};

file(
  'tokens.css',
  `:root {
  --paper: #f6f4ef;
  --surface: #ffffff;
  --ink: #17181c;
  --ink-soft: #6b6d76;
  --line: #e4e1d9;
  --accent: #3b5bdb;
  --positive: #237a33;
  --negative: #c92a2a;
  --radius: 14px;
  --font: system-ui, -apple-system, "Segoe UI", sans-serif;
}
`,
);
file(
  'app.css',
  `* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.45 var(--font); color: var(--ink); background: var(--paper); }
.screen { min-height: 100vh; display: flex; flex-direction: column; padding: 56px 20px 24px; gap: 16px; }
.screen--wide { padding: 32px 40px; }
.bar { display: flex; align-items: center; justify-content: space-between; }
.back { color: var(--accent); font-weight: 600; padding: 11px 0; margin: -11px 0; } /* a 44px tap target, laid out as text */
h1 { margin: 0; font-size: 28px; letter-spacing: -0.02em; }
h2 { margin: 0; font-size: 17px; }
.muted { color: var(--ink-soft); }
.grow { flex: 1; }
.btn { display: block; width: 100%; padding: 15px; border: 0; border-radius: var(--radius); font: 600 16px var(--font); background: var(--line); color: var(--ink); }
.btn--primary { background: var(--accent); color: #fff; }
.btn--ghost { background: transparent; color: var(--accent); }
.field { display: grid; gap: 6px; }
.field input { padding: 14px; border: 1px solid var(--line); border-radius: var(--radius); font: inherit; background: var(--surface); }
.field--error input { border-color: var(--negative); }
.field--error small { color: var(--negative); }
.code { display: flex; gap: 10px; }
.code span { flex: 1; aspect-ratio: 1; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); font-size: 24px; font-weight: 600; }
.card { padding: 18px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); }
.balance { font-size: 40px; font-weight: 700; letter-spacing: -0.03em; }
.list { display: grid; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
.row { display: flex; justify-content: space-between; padding: 14px 16px; border-top: 1px solid var(--line); }
.row:first-child { border-top: 0; }
.out { color: var(--negative); } .in { color: var(--positive); }
.meter { height: 8px; border-radius: 4px; background: var(--line); overflow: hidden; }
.meter i { display: block; height: 100%; background: var(--accent); }
.tabbar { display: flex; justify-content: space-around; padding: 12px 0 4px; border-top: 1px solid var(--line); color: var(--ink-soft); font-size: 13px; }
.tabbar b { color: var(--accent); }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(var(--cols, 3), 1fr); }
.side { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
.side nav { padding: 32px 20px; display: grid; align-content: start; gap: 12px; border-right: 1px solid var(--line); background: var(--surface); }
@media (max-width: 900px) { .side { grid-template-columns: 1fr; } .side nav { display: none; } } /* tablet: the menu goes, the numbers stay */
.spec { padding: 40px; display: grid; gap: 24px; background: var(--surface); }
.swatch { display: grid; gap: 6px; font-size: 13px; }
.swatch i { height: 72px; border-radius: 10px; border: 1px solid var(--line); }
`,
);

// One frame file: the app's css and tokens, then the body.
const screen = (path, body, wide) =>
  file(path, `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<link rel="stylesheet" href="${'../'.repeat(path.split('/').length - 1)}tokens.css">\n<link rel="stylesheet" href="${'../'.repeat(path.split('/').length - 1)}app.css">\n</head>\n<body>\n<main class="screen${wide ? ' screen--wide' : ''}">\n${body}\n</main>\n</body>\n</html>\n`);
const rows = (list) => `<div class="list">${list.map(([a, b, cls = '']) => `<div class="row"><span>${a}</span><span class="${cls}">${b}</span></div>`).join('')}</div>`;
const tabbar = (on) => `<div class="tabbar">${['Home', 'Activity', 'Budgets', 'Profile'].map((t) => (t === on ? `<b>${t}</b>` : `<span>${t}</span>`)).join('')}</div>`;

const store = new Store(root);
const call = (tool, args = {}) => run(store, tool, { project, ...args });
const frames = async (page, list) => {
  for (const [id, title, device, step, description, extra] of list) await call('add_item', { page, type: 'frame', id, title, src: `screens/${page}/${id}.html`, device, ...(step && { step }), description, ...extra });
};

// ---- onboarding -----------------------------------------------------------------------------------

await call('add_page', { id: 'onboarding', title: 'Onboarding', description: 'From first open to a working account.' });
screen('screens/onboarding/welcome.html', `<div class="grow"></div><h1>Know where your money goes.</h1><p class="muted">Pocket sorts every payment and warns you before a budget runs out.</p><button class="btn btn--primary" id="start">Get started</button><button class="btn btn--ghost" id="signin">I have an account</button>`);
screen('screens/onboarding/email.html', `<div class="bar"><span class="back">Back</span></div><h1>Your email</h1><p class="muted">We send a six-digit code. No password to remember.</p><label class="field">Email<input value="sam@example.com"></label><div class="grow"></div><button class="btn btn--primary" id="send">Send code</button>`);
screen('screens/onboarding/code.html', `<div class="bar"><span class="back">Back</span></div><h1>Enter the code</h1><p class="muted">Sent to sam@example.com</p><div class="code"><span>4</span><span>8</span><span>1</span><span>9</span><span>0</span><span>2</span></div><div class="grow"></div><button class="btn btn--primary" id="verify">Verify</button>`);
screen('screens/onboarding/code-error.html', `<div class="bar"><span class="back">Back</span></div><h1>Enter the code</h1><label class="field field--error">Code<input value="481903"><small>That code is wrong or expired.</small></label><div class="grow"></div><button class="btn btn--primary" id="retry">Send a new code</button>`);
screen('screens/onboarding/bank.html', `<h1>Connect a bank</h1><p class="muted">Read only. Pocket can never move money.</p>${rows([['Northwind Bank', 'Connect'], ['Contoso Credit Union', 'Connect'], ['Fabrikam Savings', 'Connect']])}<div class="grow"></div><button class="btn btn--ghost" id="skip">Skip for now</button><button class="btn btn--primary" id="connect">Connect Northwind</button>`);
await frames('onboarding', [
  ['welcome', 'Welcome', 'phone', '1.1', 'First open. One promise, one action; signing in is secondary.'],
  ['email', 'Email', 'phone', '1.2', 'Email only, no password. The button stays disabled until the address parses.'],
  ['code', 'Code', 'phone', '1.3', 'Six boxes, filled from the SMS or the clipboard. Verify sends at the sixth digit.'],
  ['code-error', 'Code: wrong', 'phone', '1.3b', 'Same screen, error state. After three wrong codes the only action is a new code.'],
  ['bank', 'Connect a bank', 'phone', '1.4', 'Optional. Skipping lands on an empty home with a prompt to connect later.'],
]);
await call('add_item', { page: 'onboarding', type: 'node', shape: 'terminal', id: 'open', title: 'App opened' });
await call('add_item', { page: 'onboarding', type: 'node', shape: 'diamond', id: 'code-ok', title: 'Code right?' });
for (const [from, to, label, tone] of [
  ['open', 'welcome', null, 'neutral'],
  ['welcome#start', 'email', 'tap Get started', 'positive'],
  ['email#send', 'code', 'tap Send code', 'positive'],
  ['code#verify', 'code-ok', 'tap Verify', 'neutral'],
  ['code-ok', 'bank', 'yes', 'positive'],
  ['code-ok', 'code-error', 'no', 'negative'],
  ['code-error#retry', 'code', 'tap Send a new code', 'neutral'],
]) await call('connect', { page: 'onboarding', from, to, ...(label ? { label } : {}), tone });
await call('layout_flow', { page: 'onboarding', ids: ['open', 'welcome', 'email', 'code', 'code-error', 'code-ok', 'bank'], x: 0, y: 0 }); // from the arrows, as an agent would
await call('group_items', { page: 'onboarding', id: 'sign-up', ids: ['open', 'welcome', 'email', 'code', 'code-error', 'code-ok', 'bank'], title: 'Sign up', description: 'No passwords: email and a one-time code. A wrong code never clears what was typed.' });

// ---- app ----------------------------------------------------------------------------------------

await call('add_page', { id: 'app', title: 'App', description: 'The everyday screens on phone, tablet and the web.' });
screen('screens/app/home.html', `<div class="bar"><h2>Hi Sam</h2><span class="muted">Oct</span></div><div class="card"><div class="muted">Left this month</div><div class="balance">$1,284.50</div><div class="meter"><i style="width:62%"></i></div></div><div class="bar"><h2>Recent</h2><span class="back" id="all">See all</span></div>${rows([['Blue Bottle', '−$6.40', 'out'], ['Salary', '+$3,200.00', 'in'], ['Whole Foods', '−$84.12', 'out']])}<button class="btn btn--primary" id="add">Add expense</button><div class="grow"></div>${tabbar('Home')}`);
screen('screens/app/activity.html', `<div class="bar"><span class="back">Home</span></div><h1>Activity</h1><label class="field"><input placeholder="Search payments"></label><div class="muted">Today</div>${rows([['Blue Bottle', '−$6.40', 'out'], ['Lyft', '−$18.20', 'out']])}<div class="muted">Yesterday</div><div id="row">${rows([['Whole Foods', '−$84.12', 'out'], ['Salary', '+$3,200.00', 'in'], ['Netflix', '−$15.49', 'out']])}</div><div class="grow"></div>${tabbar('Activity')}`);
screen('screens/app/payment.html', `<div class="bar"><span class="back">Activity</span><span class="back">Edit</span></div><div class="muted">Whole Foods · Yesterday 18:42</div><div class="balance out">−$84.12</div>${rows([['Category', 'Groceries'], ['Account', 'Northwind ··4410'], ['Budget left', '$215.88']])}<label class="field">Note<input placeholder="Add a note"></label><div class="grow"></div><button class="btn" id="split">Split with someone</button>`);
screen('screens/app/add.html', `<div class="bar"><span class="back">Cancel</span></div><h1>Add expense</h1><div class="balance">$0.00</div><label class="field">What for<input placeholder="Coffee"></label><label class="field">Category<input value="Eating out"></label><div class="grow"></div><button class="btn btn--primary" id="save">Save</button>`);
screen('screens/app/budgets.html', `<h1>Budgets</h1><div class="grid" style="--cols:2">${[['Groceries', 72], ['Eating out', 94], ['Transport', 40], ['Fun', 15]].map(([t, p]) => `<div class="card"><h2>${t}</h2><p class="muted">${p}% used</p><div class="meter"><i style="width:${p}%${p > 90 ? ';background:var(--negative)' : ''}"></i></div></div>`).join('')}</div><div class="grow"></div>${tabbar('Budgets')}`);
file('screens/app/dashboard.html', `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<link rel="stylesheet" href="../../tokens.css">\n<link rel="stylesheet" href="../../app.css">\n</head>\n<body>\n<div class="side"><nav><h2>Pocket</h2><b>Overview</b><span class="muted">Activity</span><span class="muted">Budgets</span><span class="muted">Accounts</span><span class="muted">Settings</span></nav><main class="screen screen--wide"><h1>Overview</h1><div class="grid"><div class="card"><div class="muted">Left this month</div><div class="balance">$1,284.50</div></div><div class="card"><div class="muted">Spent</div><div class="balance out">$1,915.50</div></div><div class="card"><div class="muted">Saved</div><div class="balance in">$420.00</div></div></div>${rows([['Whole Foods', '−$84.12', 'out'], ['Salary', '+$3,200.00', 'in'], ['Netflix', '−$15.49', 'out'], ['Lyft', '−$18.20', 'out']])}</main></div>\n</body>\n</html>\n`);
await frames('app', [
  ['home', 'Home', 'phone', '2.1', 'What is left this month, then the last three payments. The meter turns red past 90%. The same page serves tablets.', { sizes: ['tablet'] }],
  ['activity', 'Activity', 'phone', '2.2', 'Every payment, newest first, grouped by day. Search covers merchant and note.'],
  ['payment', 'Payment', 'phone', '2.3', 'One payment. Changing its category moves it between budgets at once.'],
  ['add', 'Add expense', 'phone', '2.4', 'For cash. The amount pad opens first; Save needs an amount.'],
  ['budgets', 'Budgets', 'tablet', '3.1', 'Tablet layout: two columns of budget cards.'],
  ['dashboard', 'Overview', 'desktop', '4.1', 'Web: the same numbers as home, with room for the full list. Also opened on tablets.', { sizes: ['tablet'] }],
]);
await call('arrange', { page: 'app', ids: ['budgets', 'dashboard'], x: 0, y: 2200, gap: 200 });
for (const [from, to, label, tone] of [
  ['home#all', 'activity', 'tap See all', 'neutral'],
  ['activity#row', 'payment', 'tap a payment', 'neutral'],
  ['home#add', 'add', 'tap Add expense', 'positive'],
]) await call('connect', { page: 'app', from, to, label, tone });
await call('layout_flow', { page: 'app', ids: ['home', 'activity', 'payment', 'add'], x: 0, y: 0 });
await call('group_items', { page: 'app', id: 'spending', ids: ['home', 'activity', 'payment', 'add'], title: 'Spending', description: 'Amounts are always signed and coloured by direction, never by colour alone.' });
await call('group_items', { page: 'app', id: 'tablet', ids: ['budgets'], title: 'Tablet' });
await call('group_items', { page: 'app', id: 'web', ids: ['dashboard'], title: 'Web' });

// ---- design system --------------------------------------------------------------------------------

await call('add_page', { id: 'design-system', title: 'Design System' });
const spec = (path, body) => file(path, `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<link rel="stylesheet" href="../../tokens.css">\n<link rel="stylesheet" href="../../app.css">\n</head>\n<body>\n<main class="spec">\n${body}\n</main>\n</body>\n</html>\n`);
spec('screens/design-system/colors.html', `<h1>Colors</h1><div class="grid" style="--cols:5">${['paper', 'surface', 'ink', 'ink-soft', 'line', 'accent', 'positive', 'negative'].map((t) => `<div class="swatch"><i style="background:var(--${t})"></i><b>--${t}</b></div>`).join('')}</div>`);
spec('screens/design-system/type.html', `<h1>Type</h1><div class="balance">$1,284.50</div><span class="muted">Balance · 40 / 700</span><h1>Screen title</h1><span class="muted">Title · 28 / 700</span><h2>Section</h2><span class="muted">Section · 17 / 600</span><p>Body text for descriptions and rows. 15 / 400, line height 1.45.</p>`);
spec('screens/design-system/controls.html', `<h1>Controls</h1><div class="grid" style="--cols:3"><button class="btn btn--primary">Primary</button><button class="btn">Secondary</button><button class="btn btn--ghost">Ghost</button></div><label class="field">Field<input placeholder="Placeholder"></label><label class="field field--error">Field with error<input value="481903"><small>That code is wrong or expired.</small></label>${rows([['Row', '−$6.40', 'out'], ['Row', '+$3,200.00', 'in']])}<div class="meter"><i style="width:62%"></i></div>`);
await frames('design-system', [
  ['colors', 'Colors', 'document', null, 'Every token in tokens.css. Change a value with set_token and every frame follows.'],
  ['type', 'Type', 'document', null, 'Four sizes, one family. No other sizes in screens.'],
  ['controls', 'Controls', 'document', null, 'Buttons, fields, rows and the meter, in each state.'],
]);
await call('arrange', { page: 'design-system', ids: ['colors', 'type', 'controls'], x: 0, y: 0, gap: 120 });
await call('group_items', { page: 'design-system', id: 'foundations', ids: ['colors', 'type'], title: 'Foundations' });
await call('group_items', { page: 'design-system', id: 'components', ids: ['controls'], title: 'Components' });

// ---- plan ---------------------------------------------------------------------------------------

await call('add_page', { id: 'plan', title: 'Plan' });
await call('add_item', {
  page: 'plan',
  type: 'table',
  id: 'roadmap',
  title: 'Roadmap',
  columns: [{ id: 'design', title: 'Design' }, { id: 'build', title: 'Build' }, { id: 'test', title: 'Test', note: 'on a real device' }],
  rows: [
    ['welcome', 'onboarding/welcome', 'done', 'built', 'passed'],
    ['code', 'onboarding/code', 'done', 'built', 'failing'],
    ['bank', 'onboarding/bank', 'done', 'in progress', ''],
    ['home', 'app/home', 'done', 'in progress', ''],
    ['activity', 'app/activity', 'draft', '', ''],
    ['dashboard', 'app/dashboard', 'draft', '', ''],
  ].map(([id, link, design, build, test]) => ({ id, title: id[0].toUpperCase() + id.slice(1), link, cells: { design, build, test } })),
  marks: { done: 'positive', built: 'positive', passed: 'positive', 'in progress': 'accent', draft: 'outline', failing: 'hatch' },
});

// ---- stress -------------------------------------------------------------------------------------

await call('add_page', { id: 'stress', title: 'Stress (40 frames)', description: 'Big enough to hit the export pixel cap at 2x and to see the layer list stay still while frames are renamed.' });
const many = Array.from({ length: 40 }, (_, n) => `s${String(n + 1).padStart(2, '0')}`);
for (const [n, id] of many.entries()) {
  screen(`screens/stress/${id}.html`, `<h1>Screen ${n + 1}</h1><div class="card"><div class="balance">${n + 1}</div><div class="meter"><i style="width:${(n * 37) % 100}%"></i></div></div>${rows([['Row a', `$${n}.00`], ['Row b', `$${n * 2}.50`, 'out']])}`);
  await call('add_item', { page: 'stress', type: 'frame', id, title: `Screen ${n + 1}`, src: `screens/stress/${id}.html`, device: 'phone', x: (n % 8) * 490, y: Math.floor(n / 8) * 1100 });
}
// rows stacked close: zoomed far out their captions have no room above them and must wait
const rowGroups = [];
for (let r = 0; r < 5; r++) rowGroups.push((await call('group_items', { page: 'stress', id: `row-${r + 1}`, ids: many.slice(r * 8, r * 8 + 8), title: `Row ${r + 1}` })).group.id);
await call('group_items', { page: 'stress', id: 'wall', ids: rowGroups, title: 'Wall of screens' });

// The seed must be clean: measure the frames (needs Chrome or Edge), then no arrow may cross another or cut
// through an item, and no screen may have a small tap target or hard-to-read text.
try {
  await call('render_frames', {});
} catch (error) {
  console.log(`demo: not checked against measured frames (${error.message})`);
}
for (const { id } of store.project(project).pages) {
  const problems = [...(await call('check_arrows', { page: id })).problems, ...(await call('check_design', { page: id })).problems];
  if (problems.length) throw new Error(`demo page ${id} has problems:\n${problems.map((p) => `  ${p.problem}`).join('\n')}`);
}
await run(store, 'checkpoint', { project, label: 'demo seeded' });
console.log(`demo: ${base}`);
