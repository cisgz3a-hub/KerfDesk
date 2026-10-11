## ADR-584 - Full remote design control

**Status:** Accepted for the maintainer's request on 10 October 2026 ("Full design control" for Phone & MCP). Extends ADR-568. Amends ADR-564's exclusion of CNC creation and CNC operation settings, and ADR-568's exclusion of recipe/layer creation and file exchange.

**Context.** Remote clients could only move existing artwork, add text and basic shapes in Laser workspaces, and edit four operation fields. An AI client could not lay out a real job: create or assign operations, apply a saved recipe, import artwork it had drawn, save, or work in a CNC workspace. Several edits also produced several Undo entries.

**Decision.** Edit-scope connections gain these tools. Each calls the same desktop store action as the matching desktop control and keeps the existing revision fence, UUID request identity, Undo, autosave and request-replay rules.

| Tool | Desktop action |
| --- | --- |
| `create_operation` (optional colour, Laser mode, name) | `createManualLayer`, `setLayerParam`, `renameOperation`, as one Undo step |
| `assign_artwork_to_operation` | `useOperationForObjects` on whole groups of editable artwork |
| `reorder_operation` (up/down) | `moveLayer` |
| `delete_operation` | `deleteLayerAndObjects`, exactly like Delete layer; refused for the last operation |
| `apply_material_recipe` | `assignMaterialPresetToLayer` with the user's saved recipe |
| `update_operation` (extended) | `setLayerParam`/`renameOperation`: name, enabled, Laser mode, power, min power, speed, passes, air assist, fill interval/angle/bidirectional/cross-hatch, image lines per mm, negative image; CNC cut type, tool, depth, depth per pass, feed, plunge, spindle, step-over, pocket strategy |
| `add_svg` (≤180,000 characters) | `parseSvg` (sanitises scripts, foreign content and external references) then `importSvgObject`/`importSvgFragment` |
| `import_file` (SVG, DXF, PNG, JPEG; ≤240,000 base64 characters) | the ordinary SVG/DXF parsers and `importImageFile`; PNG/JPEG magic bytes are checked |
| `save_project` | `handleSaveProject` to the existing save target only; a never-saved project returns `saved:false` and no picker opens |
| `apply_edits` (≤40 items) | the above and the existing single edits inside one `beginInteraction`/`endInteraction`, named "Remote edits" |

`apply_edits` prepares asynchronous inputs (text outlines, SVG image hydration) first, then applies every item synchronously, so a local edit cannot interleave. Any failure rolls the whole batch back with no Undo entry. Items may refer to artwork or an operation created by an earlier item as `$<index>`.

Imports and creation now work in CNC workspaces with the ordinary CNC defaults for fresh operations. Laser fields are refused on CNC operations and CNC fields on Laser operations. Creating or assigning a Pro CNC strategy (V-carve, adaptive pocket) or introducing relief follows ADR-540: without Pro the tool returns `needs_pro` immediately and no deferred prompt is left on the PC. The phone downscales images to fit the import bound; there is no chunked transfer and no provider storage in this phase.

**Unchanged.** Frame-first Start, the Pro admission rule, artwork-sharing opt-in for previews/geometry/text, the bounded result size, and the exclusions of shell, arbitrary files, raw G-code and paths. `save_project` reveals only whether a file exists, never its name or path.

**Consequences.** Remote clients can now delete operations and their artwork; tool metadata marks these edits destructive and descriptions ask an AI to confirm first. Undo remains the recovery path. The desktop and relay must both be updated.
