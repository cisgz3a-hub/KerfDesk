# Large-file workflow — end-to-end stage map and audit

**Date:** 2026-07-30
**Status:** Audit. Report-only (CLAUDE.md rule 1) — nothing fixed here.
**Context:** ADR-268 / PR #525 fixed the IMPORT path. This audit follows one large file
through every stage that touches it afterwards, because "a 200 MB file imports" turned out not
to mean "a 200 MB file works".

## The workflow a file actually passes through

Pick → advise → read → parse → scene → render → edit → autosave → **save** → **reload** →
preview/estimate → preflight → compile → emit → save G-code → stream → inspect/simulate.

## Stage audit

Legend: **OK** verified working · **FIXED** fixed in ADR-268/PR #525 · **BROKEN** refuses or
fails at size · **UNAUDITED** not examined — no claim made.

| # | Stage | Status | Evidence |
|---|---|---|---|
| 1 | Pick / drag-drop | OK | File System Access API both targets; `resolveImportBlob` |
| 2 | Size advisory | FIXED | `ui/app/import-size-advisory.ts` — informs, never refuses |
| 3 | Read bytes | FIXED | Worker receives the Blob and reads it; main thread never materializes the file |
| 4 | Parse DXF / G-code / STL | FIXED | Import worker + `iterateLines`. Verified: 200.1 MB DXF, 100 MB G-code |
| 4b | Parse SVG | PARTIAL | Main thread only — `DOMParser` is `[Exposed=Window]`. ~1.6 MB/s, so 100 MB ≈ 1 min frozen |
| 5 | Import into scene + undo | UNAUDITED | `HISTORY_DEPTH = 50` full `Project` snapshots (`scene-mutations.ts:39`). Strings/arrays are shared by reference, so probably fine — **not measured** |
| 6 | Canvas render | FIXED | `f282efa9` — short polylines now thinned as whole units |
| 7 | Select / hit-test / transform | UNAUDITED | Hit-testing over millions of polylines never examined |
| 8 | Autosave (30 s) | FIXED | `prepareProjectForAutosave` — 971 ms → 327 ms |
| 9 | **Save `.lf2`** | **BROKEN** | `project-shape-validator.ts:205` refuses relief `meshPositions` above `RELIEF_EMBED_TRIANGLE_LIMIT` (200k). Import was demoted to an advisory, this was not — so a dense STL imports and then **cannot be saved** |
| 10 | **Reload `.lf2`** | **BROKEN** | Same validator on the load path. Also `project-shape-validator.ts:285` refuses `pixelWidth*pixelHeight > MAX_RASTER_SOURCE_PIXELS` (256M) |
| 11 | Preview toolpath / estimate | LIKELY OK | ADR-244 worker prepares unbounded off-thread; **not re-verified at 200 MB** |
| 12 | Preflight / Job Review | LIKELY OK | `compiled-work.ts` limits are an OPTIONAL parameter; ADR-243 stopped passing them. **Not verified** |
| 13 | Compile / optimize toolpath | UNAUDITED | Never examined at size |
| 14 | Emit G-code | OK | `materializeProgram` converts the real V8 `RangeError` only — integrity, correctly kept (ADR-243 pt 4) |
| 15 | Save G-code file | UNAUDITED | Output is one string; V8's measured ceiling is 536,870,888 chars (~512 MB) |
| 16 | Stream to controller | OK | `DEFAULT_GRBL_RX_BUFFER_BYTES` 120 / `MAX_SERIAL_LINE_LENGTH` 64 KB are transport facts, not policy |
| 17 | **G-code Inspector / viewer** | **BROKEN** | `gcode-view/gcode-render-model.ts:31` `DEFAULT_MAX_LINES = 500_000` plus a `maxSegments` cap. `parseGcodeProgram` no longer refuses, so the same file parses but will not open in the viewer. Line 49 also still does `text.split(...)` |
| 18 | 2D simulator / 3D viewer | UNAUDITED | Not examined at size |

## The pattern

Every break is the same shape: **a value is validated in more than one place, and only one was
demoted.** Relief triangles were demoted at import but not in the project validator. G-code line
count was demoted in the parser but not in the viewer. A demotion has to be traced through every
consumer of the value, not just the entry point.

## Other caps found, not yet triaged policy-vs-integrity

`core/gcode-time/program-timeline.ts:86` (live countdown budget) ·
`core/variables/parse-csv.ts` (10 MB / row / column caps) ·
`core/text/embedded-font.ts` (font byte limit — plausibly legitimate) ·
`core/cnc/surfacing.ts` (`MAX_SURFACING_ITERATIONS = 100_000`) ·
`core/cnc/adaptive-pocket-verifier.ts:121` (verification grid).

## Recommended order

1. **Stage 9/10 first** — it is a regression created by PR #525 and should block that merge:
   import-then-cannot-save is worse than the consistent refusal it replaced.
2. **Stage 17** — the user-visible half of the G-code story; should decimate for display like
   the canvas does, not refuse.
3. **Stages 5, 7, 13, 15, 18** — measure before changing; no claim either way today.
4. Add a CI grep for refusal language in non-test source so this drift cannot recur silently.
