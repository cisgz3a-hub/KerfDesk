# KerfDesk 2D Design and Editing Sector Acceptance

**Date:** 2026-07-13

**Baseline:** `origin/main` at `836ffd6c`

**Candidate stack:** PR #58 + PR #70 + `codex/design-9-curve-corpus`

**Status:** Candidate evidence complete; not yet shipped on `main`

## Verdict

The 2026-07-11 competitive audit rated 2D Design and Editing **7.0/10**. The Laser 9
curve-native candidate raised the combined curve/text capability to **8.8/10**, but explicitly
withheld 9+ because it lacked a broad real-world glyph and trace review corpus.

The stacked candidate now earns **9.1/10** for 2D Design and Editing. Credit comes from observed
workflows and measured geometry, not from merged-code claims. Shipped `main` remains at the audit
baseline until the stack is merged and rerun there.

## Evidence

| Capability | Evidence | Result |
| --- | --- | --- |
| Curve-native model | Schema-v2 line/cubic/elliptical-arc geometry; SVG, DXF, trace, text, shape, laser, and CNC boundaries | Accepted |
| Node editing | Anchor/control drag, corner/smooth, line/curve conversion, start point, join, and break | Accepted |
| Text design | Embedded fonts, variable text, bend, text on path, ligatures, multiline alignment, and editable source text | Accepted |
| Parametric primitives | Rectangle, ellipse, polygon, and star geometry editable after drawing in laser and CNC projects | Accepted in PR #70 |
| Undo and persistence | Parametric edit creates one undo frame; browser save retains canonical cubic geometry | Accepted in PR #70 |
| Real-browser workflow | Draw rectangle, edit corner radius, save, inspect canonical curves, and undo | Accepted in PR #70 |
| Licensed glyph corpus | 15 cases across Roboto, Inconsolata, Pacifico, and Dancing Script at 3, 12, and 50 mm | Accepted |
| Glyph topology | 339 contours; every compatibility polyline and canonical curve closed and finite | Accepted |
| Glyph editability | 7,107 canonical segments retained; independent 12 mm rerenders for every bundled font are structurally identical | Accepted |
| Curve deviation | Worst canonical-to-compatibility deviation **0.023805 mm**, Pacifico at 50 mm; gate **0.05 mm** | Accepted |
| Trace fidelity | Arch-house Line Art IoU 0.953, precision 0.979, recall 0.973; apex distance gates and 10/10 trace benchmark | Accepted in candidate base |
| CNC text geometry | Real glyph outside/inside profile and pocket regression tests | Accepted |
| Migration/output | Multi-path v1 migration plus byte-identical line-only G-code | Accepted |

## Why 9.1

The candidate now covers the complete everyday vector-design loop: create, select, transform,
align, distribute, group, boolean, offset, weld, edit nodes, preserve curves through import and
output, create/edit advanced text, edit parametric primitives, undo, save, reopen, preview, and
compile. The new corpus closes the previous acceptance report's explicit real-world glyph gate and
places a strict, reproducible error bound on all bundled font styles.

The rating remains below dedicated design leaders because text editing still opens a dialog rather
than an inline canvas editor, the primitive catalog is smaller than a full illustration package,
and the corpus does not replace broad external-user usability studies. Those are refinement gaps,
not failures in the core vector workflow.

## Score Boundary

- **Shipped `main`: 7.0/10** until the candidate stack merges and passes on `main`.
- **Stacked software candidate: 9.1/10** based on the evidence above.
- This rating does not increase Text and Variable Data, Trace/Raster, CNC CAM, UX, or hardware
  sectors automatically; each keeps its own acceptance gate.
