# MCP canvas usability audit and repair

The maintainer reported poor canvas behaviour and apparently missing creation tools. The reviewed baseline was `1212c5403478fc201953f393bd3683355ac2c44f`, tested in isolated Chromium phone and embedded MCP fixtures. No customer pairing, production record or physical machine was used.

## Reproduced problems

| Problem | Evidence and consequence | Repair |
| --- | --- | --- |
| Canvas buried on phones | At 390 × 844 the PNG started at y=632 and was capped at 240px; small screens needed scrolling before editing. | Compact connection/navigation chrome, responsive canvas stage, creation actions above it and touch tools beside it. |
| Edit hides artwork | Opening Edit hides the preview and its drawing tools while collapsed forms remain. | A properties/creation sheet keeps the Design canvas mounted and visible. |
| Creation differs by client | Phone has hidden text/rectangle forms; embedded MCP lacks them. | Visible Add text / Add shape in both; numeric rectangle/ellipse, font choice, move/rotate/resize alternatives. |
| Zoom resets after writes | Both clients change 200% to 100% while the exact new preview replaces the old image. | Shared viewport retains zoom and pan through ordinary preview replacement. |
| Pan and pinch do not navigate the canvas | Mouse Pan returns without handling the drag; a second finger cancels drawing without canvas zoom. | Explicit pointer ownership, one-finger/mouse Pan, two-finger midpoint pan/pinch, Fit/zoom and disclosed Pan buttons. |
| Selection can drift after resizing | A small screen-size change moves the PNG without repainting its outline. | Repaint after surface resize; preserve scene centre and physical scale within the viewport's zoom limits. |
| Navigation discards a completed draft | Choosing Pan silently clears the pending change. | Pan and return to the draft's tool preserve it; active strokes cancel before gesture navigation. |
| A held gesture overwrites refreshed mapping | A PC extent change adopts a new view, then the next movement reuses the gesture's old scale. | Cancel navigation ownership when accepted geometry or screen dimensions change. |
| One image disables the entire preview | The renderer rejects mixed vector/raster scenes, disabling all touch tools. | Updated desktop renders actual vectors plus explicitly labelled, dashed image placement frames. Image pixels remain omitted. |
| Viewing looks like missing features | Read-only pairing disables creation, but the reason is easy to miss. | Visible creation entry points explain editing approval; permission enforcement remains on the PC. |

## Research and implementation choice

[OpenAI UI guidance](https://developers.openai.com/plugins/concepts/ui-guidelines) recommends expanded/fullscreen presentation for rich canvases. [MCP Apps](https://apps.extensions.modelcontextprotocol.io/api/classes/app.App.html#requestDisplayMode) supplies host-mediated display modes; a host's actual response and available dimensions must govern the layout. This repair adapts to the existing host dimensions. Fullscreen request integration and an actual ChatGPT-host session remain unqualified.

[MDN Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures) documents tracking multiple pointers. [Touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action) is set only on the canvas so page scrolling and browser interaction remain available elsewhere. Pointer cancellation, lost capture, page hiding and revision/permission changes are part of the state machine, rather than exceptional commit paths.

[W3C dragging guidance](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements) supports numeric alternatives to dragging, and [target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced) informs the chosen 48px controls. These sources guide this repair; this is not a claim that the entire product has completed a WCAG conformance audit.

The current projection is a bounded raster PNG with SVG draft/selection overlays. It cannot provide sharp unlimited zoom or precise path/node editing. [Konva's scene/hit graph architecture](https://konvajs.org/docs/overview.html), [its multi-touch example](https://konvajs.org/docs/sandbox/Multi-touch_Scale_Stage.html), [Fabric's object model](https://www.fabricjs.com/docs/) and [SVG's vector representation](https://developer.mozilla.org/en-US/docs/Web/SVG) were reviewed as possible foundations. The engineering inference is that a better renderer first needs a consented, bounded scene projection from the PC; changing libraries cannot reconstruct geometry absent from the protocol. No new canvas-library dependency was added in this repair.

The next renderer stage should project canonical vector geometry, stable artwork IDs/transforms and bounded project-owned image thumbnails, with exact revisions, explicit sharing and scene/byte budgets. Use a shared SVG or canvas scene layer for both clients, then accurate hit testing and reviewed multi-handle transforms. Retain canonical PC history and mutation authority. Do not expose arbitrary project serialization, executable SVG/HTML, external URLs or client-side machine/G-code authority.

## Verification and limits

New browser scenarios use real non-square PNGs and verify physical image/overlay coordinates, not only markup or one-pixel placeholders. They exercise small phones, rotation, mouse and multi-touch navigation, draft retention, exact PC mutation arguments, numeric replacement, stale revisions, retry identity and revoked access. The generated embedded implementation is checked against the phone sources before build/deployment.

Desktop projection checks include complete mixed-scene bounds, transformed image frames, complexity limits, hidden/locked items, cancellation, opt-out and canonical rectangle creation. Actual Chromium canvas rendering verified a 768 × 768 PNG, continuous vectors, dashed image frames, zero private-source reads and zero network requests.

Local fixture tests, hosted service publication, actual ChatGPT rendering, a physical phone and an installed desktop update are distinct evidence. Image placement frames are not faithful image or burn previews. Hardware motion and physical burn behaviour were not operated or qualified. Desktop projection changes follow the release cadence; hosted phone presentation can publish independently. See [ADR-568 Amendment 1](../decisions/ADR-568-amendment-1-touch-canvas.md).
