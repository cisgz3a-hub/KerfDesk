# Browser acceptance checkpoint

Verified 2026-09-05 with the Browser plugin against controller commit 0ec227d40e2b2e0f933f01cb56c386d66cd5731d at http://127.0.0.1:5187/.

- Created five registration outlines through the rendered controls.
- Cleared Rows: showed a positive-whole-number validation message, disabled Replace, retained five objects and their selected state.
- Entered 10,000 rows and 10,000 columns: immediately showed the combined 100,000,000-object request, disabled Replace and retained the five existing objects. No generation/allocation was started.
- Switched this disposable local project to CNC, opened G-code canvas view, Preview, the explicit Cut 3D dialog, and the G-code Inspector.
- Inspector compilation completed with 66 lines and 37 segments. Show traversal moves toggled off and on through the visible checkbox; closing the dialog retained the five objects. The delayed-readiness rendering invariant is separately covered by a controlled DOM/renderer regression.
- Browser console returned zero captured warnings/errors after these interactions.
- No controller, camera, beam, spindle or machine was connected/operated. No program was exported or sent.
- The legacy Cnc3DPane/full-page component remains intentionally unmounted in App.tsx. Its modal ownership fix is covered by the actual global-shortcut and DOM fixture, not claimed as a production browser surface.

The temporary browser tab and local Vite server were closed after verification. This checkpoint is source/DOM/browser evidence, not physical qualification.
