# Changelog

Releases are git tags (`v0.1.0`). Nothing updates by itself: you pick a version, see "Updating" in the README.
A release that changes the data format says so here and ships its migration; until then every project is format 1.

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
