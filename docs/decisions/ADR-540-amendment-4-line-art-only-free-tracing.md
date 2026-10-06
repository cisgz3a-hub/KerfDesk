## ADR-540 Amendment 4 - Line Art is the only Free tracer (2026-10-04)

**Status:** Implemented locally; release and deployment remain separate.
**Amends:** ADR-540's basic/advanced tracing split and Amendment 1's browser build boundary.

The owner specified that only Line Art should be Free and every other tracer,
including Sharp, should belong to Pro. Smooth, Sharp, Line + fill and Edge
Detection had remained Free, and a new CNC trace selected Smooth automatically.

1. Line Art is the only Free trace preset. Photo shading, Smooth, Sharp,
   Centerline, Line + fill, Edge Detection and Colour layers are Pro. Multi-file
   tracing remains Pro. The picker marks each Pro choice and uses the existing
   advanced-trace request before changing the selected preset.
2. New Free traces start on Line Art for laser and CNC. Opening a trace dialog
   from recorded Pro settings also starts on Line Art in Free. Pro retains
   every preset and Smooth as its new CNC trace default.
3. Browser builds retain only Line Art's preset data. The Pro choices stay
   visible in the picker and point to desktop Pro through the existing edition
   provider. Dedicated Edge Detection and Line + fill entry implementations join
   the other removed Pro trace backends in renderer and worker builds. Shared
   contour and image primitives needed by Line Art remain available, including
   its ordinary adjustment controls.
4. Existing vector artwork remains editable and usable. This change introduces
   no checks at output, Preview, Frame, Start, Save G-code or running jobs.
   It does not change prices, open sales, enable the trial service or publish
   a new build.

Regression coverage checks every preset's label and admission, deferred unlock,
Free laser/CNC defaults, recorded settings, the bundled browser preset table,
dedicated backend refusal and the complete desktop preset table.
