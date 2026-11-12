## ADR-700 Amendment 7 - A full ELLIPSE written as −π → π closes; import P3 sweep (2026-11-13)

**Status:** Accepted. Amends ADR-700 Amendments 2–6. Code quality audit C2 fix verification
(E5-P3-2, E1-P3-1, E1-P3-3, E4-P3-1, E5-P3-1, E5-P3-3). | **Date:** 2026-11-13

### Context

- **E5-P3-2.** A full ELLIPSE written as a symmetric pair less than a whole turn apart, such as
  `−3.14 → 3.14` (the −π → π convention at 2 decimals), misses a turn by 0.0032 rad. Amendments 4–6
  close a sweep within one turn only within 1e-4 of a turn (0.00063 rad), so it stayed open. The gap
  was 0.32 mm at R = 100, in 68 % of ELLIPSEs printed to 2 decimals. Asked whether such a pair
  should close, the maintainer chose "Yes, close it".
- **E1-P3-1.** A near-straight PostScript rule between 1e-6 and about 1.4e-6 pt tall imported
  nothing, because the "has no height" test and the SVG rounding disagreed.
- **E1-P3-3.** A legitimate 1.9 M-point EPS used 61–80 % of the 5 s limit. A slower PC would have
  refused it with "may loop forever".

### Decision

1. **ELLIPSE has its own allowance within one turn: `ELLIPSE_CLOSE_SNAP` = 8e-4 of a turn
   (0.005 rad).** A sweep within it of a whole turn is one, whatever the angles' distance apart.
   - It covers 2-decimal radians, which miss a turn by a fixed 0.0032 rad (rounded to nearest, up
     or down).
   - **Largest gap closed on purpose: R × 5.03e-3**, 0.5 mm at R = 100.
   - 1-decimal angles stay as written, by the maintainer's earlier decision (Amendment 5).
     `−3.1 → 3.1` misses by 0.083 rad, 1.3e-2 of a turn, and stays open.
   - ARC keeps `WHOLE_TURN_SNAP` (1e-4 of a turn) within one turn: 2-decimal degrees already
     close.
   - Each unit's two allowances are one `TurnSnaps` value (`ARC_SNAPS`, `ELLIPSE_SNAPS`), passed to
     `counterClockwiseSweep`.
2. **E1-P3-1 is already fixed**, by the fix for audit D1-P2-4. `ps-svg.ts` now grows an axis
   exactly when its size rounds to zero in the written SVG, so the test and the rounding agree. A
   regression test imports rules 1e-6 to 3e-6 pt tall.
3. **E1-P3-3: the limits stay; the refusals name size, not only looping.**
   - Since Amendment 3 the reader runs in the import worker with a 30 s limit and Cancel. The
     1.9 M-point file reads in 2–3 s, so a slower PC has more than ten times the headroom.
   - The 5 s window limit applies only when no worker is available. The step and time bounds of
     Amendments 2–3 (E1-P1-1) are unchanged.
   - The step refusal now reads "it is too large to import, or it never finishes". The time
     refusal adds "it may be too large for this computer".
4. **Stated, no code change:**
   - **E4-P3-1.** An ARC within `WHOLE_TURN_SNAP` of closing closes (`0 → 359.99°`), bridging a gap
     of at most R × 6.3e-4. After a 0.1–0.2 mm kerf that leaves material only above a radius of
     about 160–320 mm, and then too thin to hold a part. An ELLIPSE bridges up to R × 5.03e-3
     (Decision 1).
   - **E5-P1-1 note, E5-P3-1.** Some coarse files still close, against the literal "leave as
     written": 38 % of ELLIPSEs and 4 % of ARCs at 3 significant digits. The importer sees the
     numbers, not how they were printed. Between 1 and 10 rad a 3-significant-digit angle is the
     same text as a 2-decimal one, which the decisions close. The audit found no job harm.
   - **E5-P3-3.** At 4 significant digits, an ARC that starts at 640° or more, or an ELLIPSE
     parameter of 100 rad or more, keeps 0–1 decimals. Such files import as written (Amendment 6).

### Consequences

- Full ELLIPSEs written −π → π, or otherwise short of a turn at 2 decimals, import closed.
- A deliberately open ELLIPSE arc with a gap under 0.005 rad now imports closed.
- PostScript refusals no longer call a large but finite file a possible endless loop.

### Verification

- `src/io/dxf/dxf-printed-angles.test.ts` now requires every decimal printing rounded to nearest,
  up or down to close exactly, for ARC and ELLIPSE, over 5,000 start angles. It closes
  `−3.14 → 3.14`, `0 → 6.28` and `−1.57 → 4.71`, and keeps `−3.1 → 3.1` open by its 0.083 rad. The
  "as written" rows use each unit's two allowances.
- Mutants: an ELLIPSE close allowance of 1e-4 fails the 2-decimal rows and the three audit cases.
  One of 2e-2 fails `−3.1 → 3.1` and the coarse "as written" rows.
- `src/io/postscript/convert-postscript.test.ts` imports rules 1e-6 to 3e-6 pt tall, and checks the
  new step-refusal wording. The size-bound programs that end by the time limit may now take up to
  one second past it, so a loaded machine no longer fails them.
