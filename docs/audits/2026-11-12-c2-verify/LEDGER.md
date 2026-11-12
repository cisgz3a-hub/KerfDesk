# C2 fix verification — ledger

Plan: [AREAS.md](AREAS.md). Severity follows C2:
- **P1:** harms a job, loses work or exposes a secret (METHOD §3), or lets such a defect reach `main` unchecked.
- **P2:** a real defect with limited harm. A test gap behind correct code is P2 at most.
- **P3:** structural.

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| E1 | Import and notice fixes (#1750, #1819, #1820, #1822, #1762) | origin/main @ 66a7a008c (auditor and refuter). The coordinator re-read ce6b84357: only #1777 (DXF SPLINE) touched these files, and `arcSweep` is unchanged. The C2 repros were re-run; Node scripts ran on the real modules, with pdf.js for PDF; the refuter used its own methods (path lengths, the `.rd` encoder's motion plan, real `importPostscriptFile`) | [E1-import-and-notice-fixes.md](E1-import-and-notice-fixes.md) | 10 | 0 | 4 | 3 | 3 | 0 |
| **Total** | | | | **10** | **0** | **4** | **3** | **3** | **0** |

## C2 items verified

| C2 item | Fix | Status on main |
|---|---|---|
| D1-P2-4 PostScript straight rule | #1750 | Fixed (residual P3: E1-P3-1) |
| D5-P1-1 SECURITY (redacted) | #1819 | Fixed for its payloads; the bound is escaped by other inputs (E1-P1-1) |
| D5-P3-4 SECURITY (redacted) | #1819, #1820 | Fixed |
| D5-P1-2 DXF ARC over one turn | #1820 | Fixed; regression E1-P1-2 |
| D6-P3-3→P2 cross-hatch notice | #1822 | Fixed for Fill hatches (1,120 of 1,120 combinations match); Line strokes on drawn objects are E1-P2-3 |
| D2-P1-2 Ruida `.rd` rotary feed | #1762 | Fixed for dose (97.6–102.3 %); new E1-P2-2 and E1-P3-2 |
| D2-P3-5 Ruida rotary note | #1762 | Fixed (the controller's own behaviour is still unverified on hardware) |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| E1-P1-1 | E1 | **SECURITY: the bound added by #1819 can be escaped (CWE-835 / CWE-400).** Redacted until fixed. A small crafted import still holds the window thread for minutes. | **READ** on main `ce6b84357` (location held privately). Auditor and refuter **REPRO**, with details in the coordinator's scratchpad only. | routed to the EPS/AI import session (local_de13cd2d) with the private details |
| E1-P1-2 | E1 | **A DXF full circle written as ARC `s → s + 360` can import as a near-zero arc** (a regression from #1820). After decimal rounding the difference can be one ulp over 360°, and `% 360` then leaves a dot. 152.2→512.2 burns 0 mm, where it burned 125.6 mm before the fix. This affects 10–12 % of start angles given to 0.1°, 0.01° or 0.001°. There is no note, and a cut-out loses its outline. | **READ** on main: `dxf-entities.ts` `arcSweep` sends any difference over 360° to `sweepDeg % 360` with no tolerance for a whole turn. Auditor and refuter **REPRO** (G-code and path length; pre-fix comparison). | routed to the EPS/AI import session. Fix: snap a remainder within a tolerance of a whole turn to a full turn, and share one rule with ELLIPSE (E1-P2-1) |
| E1-P1-3 | E1 | **PostScript and Illustrator 3–8 zero-width (hairline) strokes are dropped.** In PostScript, width 0 means the thinnest line, but the converter writes `stroke-width="0"`, which SVG treats as unpainted. With any other stroked or filled artwork in the file, the import reports success and the hairline outline is gone. A file with only hairlines is refused. This predates the verified fixes. | **READ** on main: `ps-svg.ts` writes `num(path.strokeWidth)` unchanged. Auditor and refuter **REPRO** (real `importPostscriptFile`). | routed to the EPS/AI import session. Fix: one shared rule that writes a zero or sub-rounding width as a positive hairline |
| E1-P1-4 (refuter) | E1 | **PDF zero-width strokes are dropped from "Editable paths" without a note** (the PDF twin of E1-P1-3). The dialog thumbnail shows the outline, while the canvas and the job lack it. | **READ** on main: `pdf-vector-page.ts` writes `stroke-width` from `state.width` unchanged. Refuter **REPRO** (real pdf.js operator list). | routed to the EPS/AI import session, with E1-P1-3 |
| E1-P2-1 | E1 | **A DXF ELLIPSE with parameters past one turn still clamps to a full ellipse**, unlike the fixed ARC. It is unchanged from before the fix. | Auditor and refuter **REPRO**. | routed to the EPS/AI import session, with E1-P1-2 |
| E1-P2-2 | E1 | **The `.rd` speed-class split burns each rotary stroke in many out-of-order pieces.** One 30 mm circle becomes 30 parts with 1.5 m of laser-off travel and 60 rotary reversals, against 2 on a flat bed. The ETA shows 11.0 s where the moves take 43.6 s. Seams on hardware are unverified. | Auditor (decoded bytes) and refuter (encoder motion plan, app clock) **REPRO**. | routed to the rotary-speed session (local_203c64d8). Fix: emit class parts in path order, merging pieces of the same class, and count the `.rd` travel in the ETA |
| E1-P2-3 (refuter) | E1 | **The old-project rotary notice still gives the worst case (6.28×) for Line strokes on drawn (non-imported) objects.** A pen-tool horizontal line compiles to 1.00× and a 45° line to 1.40×. This is D6-P3-3's symptom outside #1822's Fill fix. | Refuter **REPRO**; **READ** `old-project-rotary-feed.ts` `outlineAngles` returns "round the part" for any object that is not `imported-svg`. | routed to the rotary-speed session. Fix: read the outline angles from every object kind's own paths |

### P3s (3)

- **E1-P3-1:** a near-straight PostScript rule between 1e-6 and about 1.4e-6 pt tall still imports nothing. The threshold and the rounding disagree.
- **E1-P3-2:** the `.rd` advisory blames a Max-feed hold (up to 367 % dose) on the speed classes. The range is right and shown before output; the cause is misnamed.
- **E1-P3-3:** a legitimate 1.9 M-point EPS uses 61–80 % of the new 5 s limit, so a slower PC refuses it with "may loop forever".

### Verified clean

- **#1750:** the horizontal, vertical, rotated, scaled, fill-only, zero-height-bbox and thick-stroke rules all import.
- **#1820:** negative, equal, huge, NaN and Inf angles; −Z extrusion; the `s → s − 360` noise case, which collapsed before the fix and now does not.
- **#1822:** 1,120 of 1,120 Fill combinations match the compiled strokes.
- **#1762:**
  - flat-bed and rotary-off `.rd` bytes are identical to before the fix;
  - doses are within the announced bands;
  - the 100-part limit retries, then refuses clearly;
  - passes do not multiply parts.
- **Vitest:** the fixes' 7 test files pass (75 tests).

### Not verified

- **Hardware:** Ruida rotary seams, backlash and real idle speed.
- **Browser:** no browser run. The window-thread effect of E1-P1-1 is from READ plus Node timings.
- **Real exporters:** their ARC full-circle, ELLIPSE-parameter and zero-width-stroke habits. Nothing in the repo shows them, and nothing was downloaded.
