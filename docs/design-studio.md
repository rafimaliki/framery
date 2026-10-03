# Design studio (framery)

Decisions recorded 2026-10-03, while framery was built inside Spendfolio's repository and then extracted to
its own; status: **built**. Read this when planning or changing the studio. Where it says "Spendfolio", that was the
first project it opened.

## Goal

A local-first design studio, a small Figma of our own. It opens a project's design data from one
folder, shows its flows and design system on a free canvas, and is edited by agents through one
command surface. It has no assumptions about any one project, so it installs into any repository.

## Decisions

- **Stack: plain JS + Node, no build step, no framework, no dependencies.** Optimisation is the priority:
  RAM, speed, file size. A dependency needs a reason that beats ten lines of code.
- **Layout.** The package holds the app and nothing project-specific: `bin/` (CLI), `src/` (store,
  commands, server, MCP, renderer, init), `ui/` (the studio), `skills/` (how an agent drives it),
  `test/`. A project's data lives in the consuming repository, in `framery/<name>/`, and nothing else is there;
  it supports several projects.
- **Pages, like Figma.** One canvas component, several pages: *Flows*, *Design system*, *Plan*, others
  added by command. There is no special view: the plan is an ordinary page holding one table item.
- **Canvas.** Full-viewport, dotted background, light and dark. Drag to pan, ctrl+wheel or pinch to
  zoom, wheel to scroll, `0` fits, `1` is 100%. Double-click a frame to zoom to it.
- **Items.** Frames (an html file at any size: phone, tablet, desktop, custom), groups (a container with a
  darkened, low-opacity fill), flowchart nodes (terminal, process, diamond), tables and arrows. Placement
  is free: every item has `x`, `y`.
- **Tables.** A table item holds `columns`, `rows` (each with `cells`, and an optional `link` such as
  `flows/6_entry` that opens on click) and `marks`, which draw chosen cell words as status pills. Its size
  follows its content (fixed row and header heights), so no browser is needed to place it. An agent
  records progress with one cheap call, `set_cell`; `outline` prints the table as a text grid, so reading
  it costs a few lines, not a page of JSON.
- **Arrows.** Thin (1.5px, constant at any zoom), quiet. Each end is anchored to a frame or to an
  element inside a frame (`frame#element`, an `id` or `data-anchor` in its html) and follows it. An arrow
  has an optional label for the action, and a tone: `positive` (green), `negative` (red), `neutral` (grey).
  Several arrows on one side fan out along it.
- **Detail.** A frame's description is shown in the inspector when it is clicked; long text folds.
- **Sidebar.** Project switcher, pages (and Plan), a filterable layer tree, Settings.
- **Arrow lines.** A setting with three routes: straight, curved, and elbow, which is straight
  segments that turn at right angles, with rounded corners. Elbow is the default. An arrow too short to
  turn (zoomed far out) draws as a straight line. A selected arrow, its label and its source circle turn
  to the accent colour.
- **Settings.** Theme (system, light, dark), arrow lines, and motion (full, reduced). Motion is **on by default and
  ignores the device's reduced-motion preference**; the Settings menu is where it is turned down. Every
  duration is a token that collapses under `data-motion="reduced"`, and the camera's glide checks it.
- **Agent-edit, human-view.** A person pans, zooms and selects. Placement, grouping, arrows, tokens and
  the plan change through commands. Dragging items in the UI is out of scope until decided.
- **One command core, three doors.** `src/commands.mjs` is one table (name, description, input schema,
  handler). The stdio MCP server, the HTTP API and `framery cmd` all call it, so a tool and its
  documentation cannot drift. The studio watches the data folder and live-reloads on any change.
- **Skills live inside `framery/`.** `framery/skills/framery/SKILL.md` is the source. `framery init`
  copies it into a project's `.claude/skills` and `.omp/skills` and registers the MCP server in
  `.mcp.json`; the project mirrors it and does not own it.

## Shipping as a package

In any project: install it (from GitHub, pinned to a release tag), then `npx framery init` once. The package carries code and
skills, never project data; the data lives in the project (default `./framery/`, or `--data`).
`init` is the one deliberate wiring step, idempotent, and never runs silently at install time.
`npx framery` starts the studio; `npx framery mcp` is the server `.mcp.json` points at. Checked: `npm pack`,
install into an empty folder, `init`, start, and the UI and API answer (no dependencies). Updating is a
choice: pick a tag, install it, run `init` to refresh the skill, `doctor` to confirm. The data carries a
`format` number; a newer one than the installed version understands is refused, an older one is migrated.

## Data for agents

An agent building the app reads a flow without a browser. `outline` returns a page as text in reading
order (arrows decide the order; left-to-right rows when nothing connects): groups with descriptions,
frames with size, description, `src`, and where each arrow leads (`-> next "label" [tone]`).
`get_page` returns the JSON. Per page: `items` (`id`, `type`, `x`, `y`, `w`, `h`, `title`, `step`,
`description`, `src`, `device`, `shape`, `parent`, `autoHeight`) and `arrows` (`id`, `from`, `to`,
`label`, `tone`, `fromSide`, `toSide`). A frame also has a preview image and measured anchor boxes
under `.cache/`. Tokens stay in one css file the frames use.

## Rendering

Plain DOM; one transformed world layer (GPU-composited, `will-change` only while moving); no per-item
JS on pan or zoom beyond a culling pass. Only items near the screen exist as elements. A frame shows
a paper-coloured block when tiny, its WebP preview (half size, 3–15 KB) when small, and the live page in an iframe only
when it is wide enough on screen, the view has settled, and it is one of the six nearest the middle;
the preview fades out under it. Arrows are one SVG in screen space, redrawn on zoom and translated as a
unit on pan. Previews, anchor boxes and `autoHeight` heights come from one headless Chrome or Edge over
the DevTools protocol, re-run for stale frames only; without a browser the studio works with
placeholders. Measured (headless Chrome, 83 items, 1440×900): 60 fps through 270 frames of
wheel-zoom and pan, 1.5 MB JS heap, 1.3k DOM nodes.

## Components (decided and built, 2026-10-03)

Goal: a design-system edit shows up in every flow that uses it, like a Figma component, while a control
that is not a component yet stays plain markup until it is promoted.

- **A component is an html fragment with props**, kept in the project (`library/<id>.html`) and
  registered in `library.json`: a title, a description, and props (`text`, or an `enum` with its values
  and the classes each value adds). `button` with `variant: primary | danger | ghost`, `state`, `label`.
- **A frame refers to it by reference.** Where a component is used, the frame holds a marked region
  `<!-- fr:component button variant="primary" label="Save entry" -->…expanded html…<!-- /fr:component -->`.
  The expanded html is generated from the definition, so the frame stays a plain, valid html file: it
  opens from disk, renders in headless Chrome, and an agent reads real markup. Nothing runs in the
  browser to expand it.
- **Propagation is a rewrite.** Editing a definition (or its props) makes framery rewrite every marked
  region that uses it; the studio's file watcher then reloads the open frames and redraws previews, so
  the change is live with no refresh. The same rewrite runs from a command, so an agent can do it too.
- **Instances change props only.** Text, variant, state, icon: whatever the definition declares. An
  unknown prop is an error. Everything else follows the definition, so a button cannot drift. A frame
  that truly differs detaches the instance, which strips the markers and leaves plain markup.
- **Not a component yet is plain markup, and it is tracked.** Framery scans the frames for markup
  that repeats (the same root element and classes, 14 times) and lists these as candidates with a usage
  count and where. Promoting one writes its definition, turns the chosen copy into a reference, and
  offers the rest as matches to convert.
- **Impact is visible.** `component_usage` says which frames use a component and how many times; the
  inspector lists a frame's components; the design-system page shows each component once, with its
  variants and its usage count in the detail on click.

What exists: the library format and the rewrite engine (`src/library.mjs`), its watcher in the server, the
commands (`src/commands-components.mjs`: create, update, remove, use, detach, usage, sync, sheet,
find_candidates, promote, convert_copies), and `src/candidates.mjs`. Spendfolio now has four components in
real use: `button` (75 uses, five fills, full width or inline), `bottom-nav` (the bottom navigation bar, 64,
which destination is active), `tab-control` (the Limits / Scheduled switcher on the Plan screen, 27) and
`topbar` (60). Names matter: the bottom bar is a navigation bar, and a tab control is what switches a page's
view; `rename_component` renames one everywhere. A component's `{{prop==value?output}}` conditionals and `search` enums cover what its classes
cannot reveal. Verified: editing `topbar` changed the open frame in place with no reload; promotion only
converts a copy when the component draws it exactly, so no frame changed how it looks.

In the studio: the layer list indents each level one tab and shows a frame's components one row per
instance, in the order they sit in the frame, each named by what sets it apart (`Button · Save entry`).
Selecting one, in the list or by clicking it on the canvas inside an already selected frame, outlines the
component itself (not the frame) and opens its props and what that instance sets. Where a component is used
is shown on the design-system page only; on a flow the detail panel points there. The design-system page has a
*Library* group that draws each component in all its variants from the definition.

Not done: a component that contains another (nesting), and instance overrides beyond props.

## Export (built)

`export_item` writes a frame, a group (frames live, arrows, nodes, with a margin and the flow's caption), a
table or a node as `png`, `webp`, `pdf` or `svg` under `<project>/exports/` (never committed), at 1x to 3x
(lowered if the browser cannot draw the size). A frame is photographed from its own html; a group from the
studio's export page (`ui/export.html`), which draws the items at 1:1 with every frame live. `svg` embeds the
png: html cannot become vector paths in a browser, and `pdf` is the format that keeps text sharp. The detail
panel has the button (format, scale, Export), which downloads through `/api/export`.

## History (built)

Every edit is undoable from the studio. `framery/src/history.mjs` keeps, per project, `.history/`: each
file version once, gzipped and named by its hash, and a journal of entries (per changed file, the hash before
and after). `run()` records after every command, so the tools need no undo logic of their own, and the
studio's watcher records edits made outside the tools after two quiet seconds.

- **One prompt, one entry.** Calls less than 20 seconds apart merge into the entry open at the time, so
  storage follows what changed, not how many calls it took. `checkpoint` closes an entry.
- **Cost.** Spendfolio's design is 603 KB (167 KB gzipped). The baseline is that once; a prompt then adds the
  new versions of the files it changed, typically 10 to 15 KB. Past 500 entries or 50 MB the oldest fold into
  the baseline. `.cache/`, `exports/` and files over 5 MB are not versioned.
- **Restore** writes a past state back and is itself an entry, so it can be undone; every version is hash-checked
  before anything is written. The unit is a point in time, not one change: undoing an old entry alone would
  conflict with the work after it.
- **Ceiling.** Whole-file blobs, no deltas (zlib handles repeated page JSON well enough). Calls from separate
  processes serialise on a lock directory.

## Out of scope for now

Dragging, resizing or drawing in the UI; collaboration; accounts; export to other tools; any network
call; bundled fonts or a bundler.
