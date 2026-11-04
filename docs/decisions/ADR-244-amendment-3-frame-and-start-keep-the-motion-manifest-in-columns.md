## ADR-244 Amendment 3 - Frame and Start keep the motion manifest in columns (2026-11-04)

**Status:** Accepted on 2026-11-04 |
**Amends:** ADR-244 (large-job preview and estimate prepare off the main thread), its
Amendments 1 and 2, and the ADR-345 Start handoff, with the memory budget of performance audit
S1 (1.5 GB peak for the whole app)

### Context

Performance audit S1 found that Frame and Start prepare photo jobs with no memory bound
(S4-P2-2, and the emission part of S3-P2-3 that Amendments 1 and 2 left open). One bed-sized
photo (4000 x 3000 at 400 x 300 mm, 10 lines/mm: 6.8-8.0 million lines, 62-76 MB of G-code)
took Chrome past 6-7.7 GB during Frame, and Frame never finished. A 100 mm photo's first Start
peaked at 1.83-1.95 GB, and repeated Frame/Start cycles climbed to 3.2-5.4 GB.

A Node stage profile of the worker's Start preparation (`prepareOutputRequest`, 2.0 M lines)
put most of it in the motion manifest, one object per block and per point:

- `buildMotionManifest`: +576 MB of retained heap (about 290 bytes a line);
- `archiveCanvasMotionPlan` packed those objects again (128 bytes a line) while they were alive,
  and the worker posted the packed copy without a transfer list, so it was copied;
- the window unpacked it back into objects (`executionArtifactCanvasPlan`), and the canvas built
  a further object per block for its route (`legacySequence`).

Around it, `split('\n')` held every line at once in the parser, the preflight scanners and
`fingerprintGcode`, and the ETA's planner columns were alive at the same time as the manifest.

Browser runs found a second, older defect. Once Frame finished for the bed photo, its Start was
refused: Job Review's frame-first gate measured the Frame bounds again on the window, from a
prepared job whose streamed raster rows (`rowProvider`, used above 4 MP,
`STREAMED_RASTER_PIXEL_THRESHOLD`) had stayed in the worker
(`prepareOutputForStructuredClone`). The image had no rows there and no bounds, the signature
no longer matched the Frame, and the gate revoked it ("The framed coordinates or machine setup
changed during review"). Every photo above 4 MP at its output resolution was affected.

### Decision

1. **The manifest is columns.** `MotionManifest.blocks` is a `MotionBlockSequence`: `length`,
   `at(index)` and iteration, which a plain array also satisfies, so fixtures and archives
   written before this amendment still read. The parser writes `MotionBlockColumns`
   (`src/core/job/motion-block-columns.ts`) directly: raw and sendable line (Uint32), kind
   (Uint8), each block's point end (Uint32), route end (Float64), N-word (Float64, NaN for none,
   allocated only once a block has one), and the points' x and y (Float64), with z only once a z
   differs from the first. Every number keeps its original double:
   - a block whose first point is the previous block's last point (Object.is on x, y and z)
     stores it once, flagged in its kind byte;
   - `lengthMm` is the parser's own `polylineLength` of the same doubles and `routeStartMm` the
     previous block's route end, as the parser carried them, so neither is stored.
   About 37 bytes a line in place of about 290 as objects. The parser walks lines with
   `iterateLines` and sizes the columns from the line count, since a line yields at most one
   block. Parks are classified on the columns, all found before any is applied, as before.
2. **Packing copies nothing; the handoff transfers.** The packed form (`packed-motion-manifest-v2`)
   is the summary plus the columns object. A plan past 4,096 blocks or 8,192 points is packed;
   a smaller one keeps plain blocks as before. The preparation worker transfers the columns'
   buffers, and the window wraps them without validating (`transferredCanvasMotionPlan`, the
   worker is this application). Archives and other threads' replies are validated
   (`isMotionBlockColumnData`: line order, kinds, point ranges, finite points, route end equal to
   route start plus length). Recovery archives written in the v1 encoding are still read
   (`packed-motion-manifest-v1.ts`). Consumers read through `at()` and iteration; the canvas
   motion sequence is a view over the blocks (`mappedSequence`), and the planned route walks the
   columns in place (`visitPreviewMotionSegments`).
3. **No whole-program line arrays where a count or one pass will do.** The preflight scanners walk
   `iterateGcodeLines` instead of one shared `split('\n')`; `fingerprintGcode` counts lines in its
   hash loop; Job Review's G-code tile and stream-throughput warning, `countSendableLines` and the
   Start's sendable-line assertion count through the `sendable-line-scan` walk, which keeps
   `splitLines`' exact definition.
4. **Dense metrics first.** For a program past the 25,000-line analysis budget there is no
   executable sidecar to take bounds from, so `okPreparation` builds its metrics, and frees the
   ETA's planner columns, before the canvas plan allocates the manifest. The metrics are the same.
5. **The frame-first gate uses the bounds the preparation measured.** Job Review checks the Frame
   with `preparedStartFrameBounds`: the `frameJobBounds` and `frameMotionBounds` that
   `buildPreparedJobMetrics` took of the same machine-space job, with the rows present, exactly
   what `preparedFrameBounds` would compute there. The gate's rule is unchanged.

G-code, emission, preflight results, the Frame and Start policy, the ETA and every timing number
are unchanged.

### Consequences

- The recovery archive charges the manifest at its column size. With the 64 MB per-artifact
  budget, raster jobs up to about 1.4 million lines now keep a recovery copy, against about
  490,000 before; the bed photo still does not. Job Review's "too large to keep a recovery copy" warning
  follows the same figure.
- Code that indexed `manifest.blocks[i]` or used array methods on it reads through `at()`,
  iteration or `Array.from`.

### Verification

Node 25, untracked stage profiler of the worker's Start preparation (peak RSS of the test process;
a bare process is about 155 MB; a synthetic photo, as in Amendment 2):

| Photo | Lines | Before | After |
|---|---|---|---|
| 2000 x 1500 | 2.0 M | 1,161 MB, 27.5 s | 714 MB, 16.1 s |
| 4000 x 3000 | 8.0 M | about 5 GB, not run | 1.21 GB, 69 s |

- G-code SHA-256 is the same before and after: `11b7ea4dd01fd828...` at 2000 x 1500, and
  `1d9244431a73670e...` at 4000 x 3000, the hash Amendment 2 recorded for main.
- At 8 M lines the manifest's columns are 296 MB; parsing them alone adds about 306 MB.

Chrome 156 (headless, production build, the S4 refuter's harness `r.mjs` with its simulated GRBL
and per-second memory poller, a fresh context per set; main is the audit's `dist-main` build).
The photo is the refuter's 4000 x 3000 JPEG, imported and saved by main's own UI. Main's run of
the Fill job was stopped by the free-memory watchdog when other work on the PC left 740 MB free:

| Job | Main | This amendment |
|---|---|---|
| Bed photo, Frame | never finished: 6.2-7.7 GB, watchdog | **36.6-37.4 s, 1.07-1.09 GB** |
| Bed photo, Start to Job Review | not reached | 41.3-41.7 s, 2.07-2.18 GB; longest block 0.77-0.92 s |
| Bed photo, Start job to first line | not reached | 4.3-4.6 s |
| 100 mm photo, Frame (3 cycles) | 1.39 / 1.85 / 2.65 GB | 0.94 / 1.40 / 1.43 GB |
| 100 mm photo, Start (3 cycles) | 1.83 / 2.17 / 3.22 GB | 1.15 / 1.51 / 1.60 GB |
| 100 mm photo, after GC | 1.49 GB, heap 203 MB | 1.02 GB, heap 82 MB |
| Fill job, 271,393 lines, Frame / Start (3 cycles) | not measured (see below) | 0.92-1.28 GB / 1.09-1.26 GB, first line 0.40-0.43 s |

- Save G-code is byte-identical to main, header comments aside (version, commit, build time), for
  the audit's Fill projects (271,393 and 101,367 lines), its 200-object mix and 200-line job, the
  100 mm photo (432,897 lines) and the bed photo (6,828,149 lines).
- Tests: `motion-block-columns.test.ts` compares every field of every block with the previous
  object parser (kept as `motion-manifest-object-reference.test-support.ts`) using Object.is, on
  24 generated programs of 400 lines under laser, CNC and Smoothieware (arcs, Z, N-words, M0/M1,
  G91, G20, zero-length moves, -0, CRLF and CR). It guards the size (under 40 bytes a raster
  line) and the validator's refusals. `packed-motion-manifest.test.ts` covers clone, transfer,
  archive export and corruption; `packed-motion-manifest-v1.test.ts` the legacy archives;
  `output-preparation.test.ts` the frame-first gate of a streamed image across the worker
  boundary; `sendable-line-scan.test.ts` the new counts against `splitLines` on 4,000 programs.

### What the 1.5 GB budget still needs

Frame now fits for one bed-sized photo. Start does not: the window holds about 0.9-1.0 GB with
the photo open, and Start adds:

- **two preparations at once**: the Frame's permit keeps its program and manifest while Start
  prepares again, as ADR-565 requires, and Job Review's Confirm may prepare once more;
- the preparation worker's heap, about 1 GB at its peak, until it is collected;
- the streamer's queue: the window splits the program into 6.8 M strings to stream it
  (`createStreamer`) and joins them into the worker's buffers (ADR-354 Amendment 3);
- garbage on the window while the job starts, up to 1.4 GB of heap in the first seconds of the
  bed photo's run, which a collection returns to 39 MB.

Save G-code of the bed photo still takes 14.7-15.4 s on every save, all of it emission and
preflight; this amendment does not change it.
