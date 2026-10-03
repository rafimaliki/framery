# Changelog

Releases are git tags (`v0.1.0`). Nothing updates by itself: you pick a version, see "Updating" in the README.
A release that changes the data format says so here and ships its migration; until then every project is format 1.

## 0.1.1

`doctor` also checks the design: every arrow ends on an item that exists and every frame has its file.

## 0.1.0

First release. Free canvas pages of frames, groups, flowchart nodes, tables and labelled arrows; component
library with promotion of repeated markup; design tokens; export to png, webp, svg and pdf; undo trail with
history, undo and restore; MCP server, HTTP API and CLI over one command table; `init` and `doctor`.
