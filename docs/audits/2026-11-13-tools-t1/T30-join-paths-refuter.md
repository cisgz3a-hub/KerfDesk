# T30 Join Paths — refuter report
Tree: origin/main @ f8c17f8c4 (`C:\Users\stolk\kd-t1\t29-main`, read only). Command id: `tools.join-paths`.
Own scripts and logs: `C:\Users\stolk\kd-t1\zz-t30r\` (own G-code decoder `gdecode.ts`; the auditor's helpers were not used). Run from the tree root with `--config C:/Users/stolk/kd-t1/zz-t30r/vitest.config.mts --maxWorkers=1`, `NODE_OPTIONS=--no-experimental-webstorage`; free memory 2.7–3.0 GB before each run.

## Verdicts

| ID | Auditor | Verdict | Final |
|---|---|---|---|
| T30-P1-1 variable text in a single-line font burns the template after Join | P1 | **CONFIRMED** (all 4 bundled single-line fonts, real template parser and real `renderVariableText`) | **P1** |
| T30-P1-2 doubled / out-and-back path closed into a zero-area loop that kerf drops | P1 | **CONFIRMED mechanism, RE-SCOPED, RE-GRADED** — only kerf ≠ 0 drops it; Job Review *does* warn in the common layout; DXF import (the cited common source) already makes the same loop on import, before Join; no bundled single-line glyph retraces | **P2** |
| T30-P2-1 Join takes jig artwork out of the jig | P2 | **RE-GRADED** — ordinary jig artwork is unaffected (real jig action: legacy copy ids carry identity in the id, box-A sources are inferred from their copies); harm needs a `registration-jig-copy-v2:` id, which the allocator only makes for a source id ≥ ~141 characters or an id clash | **P3** |
| T30-P3-1 … P3-5 | P3 | P3-1 confirmed (arithmetic), P3-2/3/4 confirmed by read, P3-5 not rechecked | P3 |

## Evidence per claim

### T30-P1-1 — CONFIRMED, P1
Script `r1-variable.test.ts`, log `r1-variable.log`. Different method from the auditor: text built from the template with the real `parseVariableTemplateSource` and the real single-line route `computeTextGeometry(req, undefined, …)` (what the text worker runs), burned through `prepareOutputSnapshot` with the app's real `renderVariableText` (not a hand-written renderer), decoded with my own decoder.

- **Bundled single-line fonts** (`FONT_REGISTRY`, `geometry: 'single-line'`): Relief SingleLine, EMS Nixish, EMS Decorous Script, EMS Casual Hand. All four fail the same way.
- **Reach.** Join needs one open path, and every single-line text is open strokes (14–44 open curves per template), so the variable text **alone** enables Join (`selectionCanJoinPaths` true). For the same selection `selectionCanWeld` is false, so the #1882 guard works for Weld and is simply not consulted by Join: `selectionCanJoinPaths` (`selection-command-state.ts:152-167`) and `joinSelection` / `selectedRepairObjects` (`vector-repair-actions.ts:110-169`) never call `geometryToolSources` / `geometryToolSkipReasons`. Select All with an ordinary open SVG (R1c) also enables it and absorbs the text. Outline-font variable text is untouched: it has only closed contours, so Join has nothing to edit in it.
- **The object is always rebuilt.** Join closes the loops inside the template glyphs themselves (2–6 closures per template, "0 gap(s)" joined), so the text is rebuilt as `imported-svg` with no `variableTemplate` even when nothing else joins.
- **Burn (serial 42 / 43):**

| Font, template | before #42 lit / width | before #43 | after #42 lit / width | after #43 | value oracle width | template width |
|---|---|---|---|---|---|---|
| Relief, `SN {{serial:4}}` | 84.703 / 30.472 | 85.372 | 142.238 / 51.592 | 142.238 | 30.472 | 51.592 |
| Nixish, `SN {{serial:4}}` | 102.491 / 33.419 | 102.390 | 173.827 / 54.251 | 173.827 | 33.442 | 54.255 |
| Decorous, `{{serial:3}}` | 40.093 / 11.230 | 40.103 | 121.019 / 37.471 | 121.019 | 11.244 | 37.486 |
| Casual Hand, `Lot {{date:YYYY}}-{{serial:4}}` | 118.034 / 46.043 | 118.865 | 308.454 / 93.971 | 308.454 | 40.667 | 93.971 |

  After Join the burn width equals the stored template width, not the value, and #42 and #43 burn identically. The toast is only "Joined 0 gap(s), closed 2 path(s). 18 open path(s) remain."; no notice. Undo restores the text with its template (R1c).
- **Intent:** ADR-350 Amendment 1 ("Variable data is not rebuilt") lists Weld, Booleans, Offset and Dogbone; Join rebuilds objects the same way (`vector-path-join.ts:169-177`, `kind: 'imported-svg'`). Same harm as T26-P1-1 / T28-P1-1, both P1. Engraving a serial in a single-line font is the normal use of those fonts. **P1 stands.**

### T30-P1-2 — mechanism CONFIRMED, re-graded P2
Script `r2-sliver.test.ts`, log `r2-sliver.log`. Fixture: a closed 60×30 frame plus a 30 mm slit inside it, as (a) two identical open objects, (b) two objects one reversed, (c) one exact out-and-back path; and a single slit as control. Line operation, each setting compiled with `prepareOutput` → `emitPreparedGcode` and decoded; "interior" = lit moves more than 1.5 mm inside the frame.

1. **Decoded burn with and without kerf.** Join reports "Joined 1 gap(s), closed 1 path(s)" (out-and-back: "Joined 0, closed 1").

| Setting | interior before | interior after Join |
|---|---|---|
| no kerf | 60.000 | 60.000 (unchanged) |
| kerf +0.1 / −0.1 / +0.001 | 60.000 | **0.000** |
| lead-in + lead-out 2 mm, no kerf | 60.000 | 60.000 |
| tabs 4 × 0.5 mm, no kerf | 60.000 | 60.000 |
| 2 passes, no kerf | 120.000 | 120.000 |
| single-slit control, any setting | 30.000 | 30.000 (Join refuses) |

   **The drop is specific to kerf offset**, at any non-zero value. Root cause: `offsetClosedPolylines` normalises with `normalizeClosedPolylineTreeEvenOddChecked` (`kerf-offset.ts:62-64`) before offsetting, and that drops a zero-area contour. Without kerf the A→B→A loop burns its 60 mm as before.
2. **Job Review does warn in the common layout.** The auditor ran `runPreflight` only. The kerf stage's diagnostic `kerf-offset-closed-up` (`layer-kerf.ts:186-200`, ADR-486 Amd 1) reaches Job Review through `compileDiagnosticWarnings`. R2d:
   - slit inside a part, kerf +0.1 (the usual sign): *"Kerf offset on layer "Cut" closed up 1 hole or slot narrower than the 0.2 mm kerf (twice its Kerf Offset), so it is missing from the job and will NOT be cut. …"*
   - standalone doubled line, kerf −0.1: *"… shrank 1 part … to nothing, so it is missing from the job and will NOT be cut."*
   - **Silent** only on the growing side: slit inside a part with kerf −0.1, or a standalone doubled line with kerf +0.1 (whole job lit 0.000 mm, no warning).
3. **How common.**
   - **DXF doubled entities do not depend on Join.** The DXF importer already runs the same pairing rule (`dxf-join-touching.ts` → `joinCurveEndpointsWithin` at `CLOSURE_EPS_MM`). Import alone turns a doubled LINE, either direction, into a **closed two-point contour** (R2b: `{"closed":true,"n":2}`). With kerf ±0.1 that already burns 0 mm on import, so Join adds nothing for DXF. A doubled edge of a four-LINE frame stays open: three ends meet at a corner, which is ambiguous.
   - **Single-line fonts do not retrace.** R4 (`r4-glyph-slivers.log`) joined 72 glyphs (A–Z, a–z, 0–9, symbols) in each of the four bundled fonts: 6–8 closures per font, **0** near-zero-area loops.
   - **The remaining Join-only inputs** are SVG or drawn artwork with an exactly duplicated, isolated open path, or a path retraced on itself, on a Line operation with kerf ≠ 0.
   - **Other tools do the same.** Close Path and Close Paths with Tolerance close the same out-and-back path into the same loop, which kerf drops (R2c).
4. **Canvas (READ ONLY).** The stored points are unchanged; only `closed` flips. An A→B→A loop's closing edge has zero length, so a stroked render looks the same as before. Not checked in a browser.
5. **Grade.** The harm is real: a cut is lost with no warning in the growing-side layouts. But:
   - the common layout (a slit inside a part, positive kerf) is announced in Job Review with "will NOT be cut";
   - the input is exact duplicate or retraced open geometry on a kerf layer;
   - the same loss reaches users without Join (DXF import, Close Path).

   That fits P2 ("a wrong result … or a missing warning", limited reach) better than a Join-specific P1. Fix at the root. Do not close a component whose result has (near) zero area, in `joinCurveEndpointsWithin`; that one change covers Join and DXF import. Apply the same check in Close Path. Make the kerf stage count a zero-area closed contour it drops, so Job Review names it. The last two are raised as T30R-P2-1.

### T30-P2-1 — re-graded P3
Script `r3-jig.test.ts` (log `r3-jig.log`) builds the jig with the real action `applyCenterArtworkInRegistrationJigSet`: two outlines; a two-stroke "L" (gap 0.01 mm) on Mark (F1111) and a square on Cut (F2222).
- Real copy ids are the legacy `registration-jig-copy:<src>:<box>`. Join on the box-B copy keeps its identity, because the identity is parsed from the id.
- The box-A source has only the explicit `registrationJig` field. Join drops that field (`registrationJigObjectIdentity` → NONE). But `registrationJigArtworkInstances` (`registration-jig-artwork.ts:206-221`) infers it back into box A from its copies' ancestry (`layoutSourceIds`).
- Result for box-A source, copy, and source + copy: runs 4 → 4, decoded order `F2222@A > F1111@A > F2222@B > F1111@B` unchanged in every case.
- **How v2 ids arise** (`r3b-jig-longid.test.ts`, log `r3b-jig-longid.log`). The allocator falls back to `registration-jig-copy-v2:<uuid>` only when the legacy id would exceed 200 characters, or on an id clash (`registration-jig-artwork.ts:144-147`). I needed a 148-character source id: a UUID plus 14 nested Break Apart `__part_1` suffixes. Then Join on the copy: copy identity NONE, order → `F1111@B > F2222@A > F1111@A > F2222@B`. Join on source + copy: runs 4 → 3, order `F1111@A > F1111@B > F2222@A > F2222@B`. This matches the auditor's numbers. The only other producer of such ids is the `trace-part:<uuid>` fallback, under the same over-200-characters rule.
- No ordinary route found that makes a v2 id. The defect is real but latent: Join drops `registrationJig` (`vector-path-join.ts:180-210`), and ADR-350 Amd 1 expects tools that keep the id ("Dogbone keeps the object's id, so they may still work on jig artwork") to keep membership. **P3**; the fix the auditor suggested (carry `registrationJig` in `repairMetadata`) is still right.

### P3 spot-checks
- P3-1: `333.35 − 333.3 = 0.05000000000001137 > 0.05` in IEEE doubles, so `<=` at `path-endpoint-join.ts:121` refuses an exact 0.05 mm gap. Confirmed. The same arithmetic also gives `100.15 − 100.1 = 0.05000000000001137`, so whether a given x joins depends on how the gap was built.
- P3-2: `selectionCanJoinPaths` uses `isConvertibleVector` (`bitmap-assembly.ts:65-72`, any `imported-svg`/text/trace/shape), while `selectedRepairObjects` excludes `isBooleanCompoundObject` (`vector-repair-actions.ts:165`). Confirmed by read.
- P3-3: `repairMetadata` has no `svgImport` or text-conversion notice. Confirmed by read.
- P3-4: `repairRemovedObjectReferences(next).scene` at `vector-repair-actions.ts:154` discards the counts. Confirmed by read.
- P3-5: wording not rechecked.

## Extra findings

### T30R-P2-1: Kerf offset silently drops a zero-area closed contour on the growing side; DXF import and Close Path create such contours without Join
- **Severity P2.** It is a wrong burn with no warning, but it needs exact duplicate or retraced open geometry on a Line operation with kerf ≠ 0. Same root as T30-P1-2; the fix is outside Join.
- **Where.**
  - The kerf stage normalises before offsetting: `kerf-offset.ts:62-64` (`normalizeClosedPolylineTreeEvenOddChecked`). A dropped zero-area contour is counted by `kerf-closed-up.ts` only when its side shrinks.
  - DXF import: `dxf-join-touching.ts:29-50` closes two coincident LINEs into a two-point closed contour. The single-curve guard "A lone line must not become a two-point closed contour" (`path-endpoint-join.ts:119-120`) shows the intent, but does not cover two curves.
  - Close Path and Close Paths with Tolerance close an out-and-back path.
- **Repro** (`r2-sliver.log`):
  - R2b: a DXF with a frame of 4 LINEs plus a doubled LINE slit imports as a frame plus `{"closed":true,"n":2}`. With kerf ±0.1 the slit's interior burns 0.000 mm (60.000 mm without kerf), straight from import.
  - R2c: Close Path and Close Paths with Tolerance (0.05, bridge) on `(10,12)→(40,12)→(10,12)` say "Closed 1 path." and the kerf +0.1 burn loses it (interior 0.000).
  - R2d: a standalone doubled line with kerf +0.1 burns 0.000 mm in total, and Job Review shows no compile warning.
- **Oracle.** Before closing, the same geometry burns 60 mm (the line twice). The canvas still shows a 30 mm line.
- **Suggested fix.**
  - Stop `joinCurveEndpointsWithin` closing a component whose closed result has (near) zero area: count it as a duplicate or leave it open. That covers Join and DXF import.
  - Add the same check to Close Path.
  - Count zero-area contours that the kerf normalisation drops, on either side, in the kerf diagnostic.

## Totals
Verdicts: T30-P1-1 confirmed P1; T30-P1-2 confirmed (mechanism) and re-graded P1 → P2; T30-P2-1 re-graded P2 → P3; P3-1…P3-4 confirmed, P3-5 not rechecked. Extra raised: 1 (T30R-P2-1, P2).
