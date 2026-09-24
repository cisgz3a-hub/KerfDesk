# Tracer upgrades: implementation and acceptance

Source baseline: `b34289b4c45ea6d878b34213a7d6c45382449a93`.
The preceding audit covered the six shipped presets: Line Art, Smooth, Sharp,
Centerline, Edge Detection and Photo shading. This ledger records the requested
repair sequence, checks and subsequent independent review.

## Batch 1: preserve detail and complete output

Status: implemented; focused regressions, production browser checks and PR CI pass.

- Preserve accepted thin gray lines through automatic contour enlargement;
  qualify angled strokes, anti-aliasing, solid regions, glyphs and holes.
- Keep tiny Centerline branches consistent when unrelated artwork changes the
  working scale; retain junction attachment and intentional spur cleanup.
- Make full Photo shading raster conversion fit the existing memory budget
  through compact processing; preserve coverage, transforms and operation
  binding. Test both default and maximum detail on the full reference portrait.

Photo subset accepted by focused checks: both uncropped portrait regressions
failed before the fix, then passed without dropping vertices. The final affected
cohort passed 67 tests in seven files; targeted lint passed. Sixteen rotation and
mirror combinations match prior coverage byte for byte, including holes and
narrow highlights. At 640 by 640 pixels, the real preflight estimates are
26,165,392 bytes (Detail 60) and 36,898,744 bytes (Detail 100), below the unchanged
64 MiB limit. No whole-application heap or hardware claim is made.

Centerline passes all 203 tests in its 25-file suite, including the new binary
and antialiased branch cases and existing ring attachment cases. An independent
72-case branch probe improves 29 cases without a regression; 28 ordinary capsule
strokes remain byte-identical. Eighteen of the shortest rounded projections still
need further study; this is not a universal scale-invariance claim.

The contour repair selectively restores erased coherent ink and complete paper
counters from the accepted native mask. Its matching scalar field retains
bilinear edge positioning, and unaffected enlarged regions remain unchanged.
The affected contour cohort passes 97 tests in 13 files, including native
preparation reuse, alpha handling, subpixel and glyph fidelity, and the real Arch
House image remaining on the enlarged grid. Seven additional scale-policy checks
pass. Targeted typed lint passes after helper extraction and test cleanup.

Integration notes: the initial repository typecheck was interrupted during
concurrent implementation and is not a pass. The next complete typecheck found a
single exact-optional test argument; it is corrected and awaits confirmation.
Two cold dev-browser startup probes timed out with modules still pending and no
captured runtime errors. The production build and startup browser check now pass,
with no captured runtime errors. Both uncropped Photo raster browser regressions
pass at 64 mm: Detail 60 and 100 each save a 640 by 640 image with all 256 gray
levels, a matching PNG, one committed source replacement and its Image operation.
The first browser test assumed an import size; it was corrected to set the actual
physical size explicitly. PR #880's `ac482993a` head passes both repository CI
(lint, types, licenses, tests and build) and Chrome UX smoke. Final integration
gates remain required after subsequent batches and the current-main refresh.

## Batch 2: reliable submission and cancellation

Status: implemented; focused cancellation and ownership regressions pass.

- Freeze commit-affecting controls during submission and keep Cancel available.
- Propagate one submission-owned cancellation signal through trace and bitmap
  workers while retaining stale-publication guards.
- Adopt a matching unfinished preview instead of decoding and tracing again.
  Qualify cancellation, replacement requests, failure and source/document edits.

Preview and Submit now share the current decode/debounce/trace preparation.
Cancellation stops owned trace and bitmap workers and prevents a late decode
from dispatching new work. Header FileReader work aborts, and late ImageBitmaps
are closed. Commit controls and crop mutations freeze while comparison, zoom
and Cancel remain available. Source content can still rebase before submission;
after submission its captured object and document identity remain authoritative.

The follow-up audit reproduced and repaired a retained-dialog cancellation bug:
replacing the source stopped the worker but left the old dialog busy. Computation
ownership and submission UI ownership are now separate so the old submission can
clear its own loading state without unfreezing an immediate retry. A seven-file
affected cohort passes 102 checks, including decoder cancellation, debounce,
settlement, source replacement and submission controls. Final integrated gates
will also qualify later caching and progress changes against these contracts.

## Batch 3: responsive previews

Status: pending.

- Reuse prepared input and recent preset results with a bounded cache keyed by
  source, resolved settings and boundary.
- Bound point-overlay rendering work; preserve precise vector geometry.
- Display real processing stages and elapsed time.
- Add at most one idle warmup worker only if measurements show it helps without
  delaying foreground work or imposing excessive memory use.

## Batch 4: dense geometry and processing

Status: pending.

- Optimise Sharp topology validation by reusing unchanged relations/indexes;
  retain the exact topology, contact, nesting and positive-gap guarantees.
- Reduce duplicate photo/curve geometry in transfer and saved projects without
  changing the visible or emitted shape. Qualify project round trips and undo.

## Batch 5: detail choices and photo realism

Status: pending.

- Offer coherent grayscale pale-detail recovery and visible small-gap cleanup
  controls with understandable defaults; qualify noise and solid-ink retention.
- Improve local photo detail using bounded adaptive sampling or simplification,
  expose midtones, and make output size/direction/resolution effects visible.
- Explain the existing grayscale/dither Image workflow alongside the editable
  filled-line photo treatment.

## Verification and release boundaries

Each substantive defect receives a failing regression before repair, then the
narrow affected checks. Broader type, lint, formatting, build and browser checks
follow integration. Performance comparisons use matching inputs and geometry;
machine contention is recorded rather than reported as a product speed claim.

The final audit will review the integrated result against these requirements,
including negative cases, cancellation, saved output and representative browser
flows. Software and rendered evidence do not qualify material or machine output.
Frame, Start and controller contracts are outside this change. The primary dirty
checkout and unrelated processes are preserved.
