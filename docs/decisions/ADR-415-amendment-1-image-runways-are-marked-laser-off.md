## ADR-415 Amendment 1 - Image runways are marked laser-off motion (2026-10-23)

**Status:** Accepted. | **Date:** 2026-10-23

Amends ADR-415 decision 4 (image overscan) and the matching sentence of ADR-495 §4. The overscan
lengths, the runway geometry and the long-blank-feed threshold are unchanged.

### Context

ADR-415 §4 and ADR-495 §4 say preflight's allowance for *marked* laser-off runs covers the largest
image overscan. The Scan Line fill emitter marks its runways (`laserOffRunwayLine`, `;
kerfdesk:laser-off-motion`), but the image emitter wrote its run-in and run-out as plain `G1 … S0`.
`isConfiguredIntentionalLaserOffMotion` excuses only marked lines, so every image runway longer
than 5 mm (Overscan 8-25 mm, or Automatic at about 4,050 mm/min and faster at 500 mm/s²) raised up
to five `long-blank-feed` warnings in Job Review and the Save toasts: "Regenerate output or lower
the fill blank-feed threshold", a threshold the UI does not have. KerfDesk's own run-up note
recommends about 10 mm at 6,000 mm/min, so following it produced the warning.

Rolling audit v2 03-P2-7 found this on 2026-10-21 (three independent reproductions); meta audit v1
M2 re-checked it on main on 2026-10-23.

### Decision

1. The image sweep emitter (`core/raster/emit-raster-sweep.ts`) appends the laser-off marker to a
   row's run-in (the S0 move to the first active pixel) whenever the row has a lead-in, and to its
   run-out (the closing S0 move) whenever the row has a lead-out. These are the moves the operator's
   overscan asked for.
2. Nothing else in a row is marked. Blank stretches between burns inside a row, the opening travel
   (already marked when it is a controlled G1 seek), and a zero-overscan row's closing move keep
   their bytes.
3. Preflight is unchanged: a marked move is excused only up to the largest overscan an output
   image or fill actually gets (plus 3-decimal rounding). An unmarked long blank feed, or a marked
   one longer than that, is still reported.

### Consequences

- Image overscan up to 25 mm, fixed or Automatic, no longer raises false `long-blank-feed`
  warnings. Real long blank feeds still do.
- Every image with overscan changes bytes: each run-in and run-out gains
  ` ; kerfdesk:laser-off-motion`. Line numbers are unchanged, so recovery and Start-from-line
  mapping are unaffected. The marker is a comment; controllers ignore it, and it adds about 28 bytes
  per runway to the stream (two per row), at the row ends rather than in its dense middle. The
  emitter revision is bumped.
- The Inspector treats a marked S0 feed as laser-off for unknown-machine programs; image runways
  are S0, so their rendering is unchanged.

### Verification

- `src/io/gcode/image-runway-blank-feed.test.ts`: a 10 mm image overscan gives no `long-blank-feed`
  (main gave five), with marked run-ins and run-outs on forward, reverse and one-way rows; no
  marker without overscan; an unmarked 8 mm and a marked 12 mm blank feed beside the image are
  still reported.
- Goldens that pinned runway bytes were re-pinned only after checking that removing every
  ` ; kerfdesk:laser-off-motion` from the new output gives the old bytes exactly: the ADR-373
  roller digests (`emit-gcode-rotary-roller.test.ts`), the shipped-pipeline and per-layer snapshots
  (`emit-gcode.snapshot`, `emit-gcode-layer-settings.snapshot`), the Marlin image pin
  (`marlin-raster-lit-end.test.ts`), the OR-1 M3 hand-off (`grbl-strategy-m3-lit-drain.test.ts`)
  and the raster row layouts (`emit-raster`, `emit-raster-compaction`, `emit-raster-scan-offset`).
  On the roller fixture (a 10 × 10 mm all-black image at default overscan, so each row is one
  burn between two runways) the file grows from 3,731 to 9,331 bytes; on rows with many burns the
  share is small.
- Code and test evidence only. Nothing was burned.
