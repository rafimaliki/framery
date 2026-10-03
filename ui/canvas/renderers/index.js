// The renderer registry. A new kind of canvas item is one file with this shape, plus one line here;
// the world never switches on an item's type.
//
//   type                          the item.type it draws
//   create(item, ctx) -> element  build the element for an item
//   update(el, item, ctx)         the item's data changed
//   destroy?(el)                  release anything heavy (iframes) before the element is dropped
//   tuneAll?(entries, view, ctx)  called with every mounted item of this type after each sync
//   refreshImages?(els) / reload?(els, paths)   optional reactions to previews or frames changing

import frame from './frame.js';
import group from './group.js';
import node from './node.js';
import table from './table.js';

export const renderers = Object.fromEntries([group, node, frame, table].map((r) => [r.type, r]));

// Draw order, bottom to top.
export const LAYER = { group: 0, node: 1, frame: 2, table: 2 };
