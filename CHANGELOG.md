# Changelog

Releases are git tags (`v0.1.0`). Nothing updates by itself: you pick a version, see "Updating" in the README.
A release that changes the data format says so here and ships its migration; until then every project is format 1.

## Unreleased

Studio:
- A lighter look: white chrome with a plum accent (soft plum in the dark theme) in place of orange, and a new icon.
- New projects start with a plum `--accent` in `tokens.css`. Existing projects keep theirs.

## 0.4.0

New tools:
- `layout_flow {group | ids}` lays a flow out from its arrows: the longest path in one row (the happier arrow first at
  a branch), every state or failure under the screen it belongs to. It returns what `check_arrows` then says.
- `check_design {page}`: tap targets under 44x44 on phone and tablet frames, text below WCAG contrast (measured in the
  rendered page), and arrows anchored to elements that are gone. `render_frames` now records contrast, so frames
  rendered by 0.3.0 are measured again on the next render.
- `batch {calls}` runs several tools as one step: all or nothing, one history entry.
- `rename_item {id, to}` changes an id safely: arrows, children, table links on any page and the preview follow.
- `move_page {id, before?}` reorders pages.

Studio:
- Play a flow as a click-through prototype: "Play from here" on a screen, "Play flow" on a group with one start, or `P`.
  ↗ plays it in a tab of its own, whose address follows the screen; the single-screen preview page is gone.
- `/` or Ctrl+K finds anything on any page.
- `.` and `,` step along the flow.
- Arrows that cross, overlap or cut through an item glow, with a count on the zoom bar.
- Labels keep off item captions and slide along their line to a clear spot.
- A group caption with no room above it waits until there is room.
- The layer list updates rows in place; an opened description stays open on refresh.
- The export panel says when it lowered the scale.
- The sidebar footer shows the version.

Fixes:
- The studio takes the next free port when 4173 is busy, and `link` follows it.
- Chrome's temp profile cleanup no longer throws `EBUSY` on Windows, which could crash the studio after a render or export.

## 0.3.0

`add_item` on a frame needs `device`: `phone`, `tablet` or `desktop` for a real screen of that device only, the new
`document` preset (960 wide, auto height) for specs, galleries and token sheets, or any name with `w` and `h`.
It no longer defaults to `phone`. Existing pages are unchanged.
New tool `move_to_page`: moves items to another page; a group takes its members, arrows between them go along,
an arrow that would cross pages is refused.
New tool `check_arrows`: lists arrows that cross or overlap another or cut through a frame, table or node, and
labels that cover an item or each other, routed with the studio's own code; the skill has agents run it after
every layout and fix what it finds.
Studio: arrows whose middle runs share a lane are spread across it instead of drawn on top of each other, and
an arrow from a control whose own side faces into its screen (a bottom button, the target above) leaves from the
nearby screen edge, and clears the screen before it turns. Arrows on a diamond start and end on its four
points instead of beside it; a second arrow on a taken side moves to the free point facing its target. A label
that would cover an item moves to the longest run of its line where it covers none.
`npm run demo` seeds a demo project (framery/pocket) for developing the studio, and fails if it draws badly.
Export: big group exports are capped at 32M pixels instead of hanging; the screenshot times out after 60s.
Studio: an edit no longer replays the layer list's and the detail panel's entry animations (the panel keeps its
scroll); the collapsed sidebar stacks History and Settings so they fit the rail.

## 0.2.1

Studio: a flowchart node (diamond, process, terminal) is hidden along with its arrows: when it has arrows and none show, it goes too.

## 0.2.0

Studio: the arrow button on the zoom bar cycles all arrows, the focused frame's arrows (the default), or none.
Focus on a frame or group shows only the arrows that touch it. The X on the detail panel closes the panel and keeps the focus.

## 0.1.1

`doctor` also checks the design: every arrow ends on an item that exists and every frame has its file.

## 0.1.0

First release. Free canvas pages of frames, groups, flowchart nodes, tables and labelled arrows; component
library with promotion of repeated markup; design tokens; export to png, webp, svg and pdf; undo trail with
history, undo and restore; MCP server, HTTP API and CLI over one command table; `init` and `doctor`.
