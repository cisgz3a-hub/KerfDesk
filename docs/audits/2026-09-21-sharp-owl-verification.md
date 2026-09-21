# Sharp tracing: original owl verification, 2026-09-21

The existing tracing/preview fixes on `origin/main` at `377e692ba` were incomplete for this
image. This repair is isolated on `codex/sharp-large-image-verification` in
`D:\LaserForge\sharp-large-image-verification`. The primary checkout and Claude's work were
preserved. At this local-verification checkpoint nothing had been merged or deployed, and
no real hardware was operated. Publication status is recorded by the subsequent PR/CI runs.

## Original image and reproduction

- Original: `C:\Users\Asus\Desktop\Owl.png`, 1254 x 1254 PNG, 2,957,472 bytes.
- SHA-256: `7e9c682821fbb079dabb29535dc85f71e47fc6008bfb38fb35257f808664a6c5`.
- Sharp output: 14,389 contours, 494,902 vertices. The committed trace keeps those counts.
- Default imported size: approximately 125.4 mm, default Scan Line Fill, 0.1 mm spacing.
- The test scene includes the standard fixture's small red line square alongside the owl.

The original file is a local verification input, not a newly committed repository asset.

## Findings and repair

1. **Compilation can exhaust memory before Preview.** With the exact saved Sharp scene,
   `compileJob` exhausted a 4 GB Node heap inside even-odd polygon normalization. A staged
   probe reached flattening/transformation (14,389 contours / 494,902 points), then stalled
   in the polygon union. The scanline sweep can consume a single even-odd traced path
   directly, resolving its coverage without allocating that redundant polygon arrangement.
   Other fill modes, artwork kinds, multiple paths and non-zero winding keep normalization.
2. **Frame requests overlapped.** Three calls could reserve the active and held preparation
   slots, then produce the queue-full toast. Motion from the first Frame could invalidate the
   second preparation and produce the stale-job toast. Calls now share one owned Frame;
   the controls show Preparing Frame and disable repeated dispatch. Failure and actual job
   edits still settle and permit retry. No stale-output check or Frame policy was removed.
3. **Idle markers duplicated heavy work.** Their worker compiled outside the shared memory
   lane and retained its heap after completion. It now reserves that lane before cloning,
   and retires before releasing it, including errors and supersession. The first process
   marker no longer builds a complete toolpath merely to read its first cut point.

The direct fill uses source boundaries rather than Clipper's intermediate 1 micrometre
rounding/short-edge cleanup. Ink coverage is preserved under the source even-odd rule; byte
identity with the previous normalization is not claimed. Analytic regressions cover the
fractional boundary, holes, overlap cancellation, self-intersection and touching contours.
Coincident even-odd crossings cancel by parity to avoid redundant spans at shared edges.

## Measured results

- In the isolated output probe before the final coincident-crossing cleanup, load/preflight completed at 2.58 s and compilation at
   3.98 s: approximately **1.40 s to compile**, producing 99,864 owl fill spans. The estimate
   and 203,835-step preview completed. The final checkpoint reported about 824 MB JS heap
   and 1.06 GB process resident memory; these are checkpoint samples, not measured peaks.
- Chrome opened the exact captured scene, prepared Preview, scrubbed to 50%, played/paused,
   then completed simulated Frame after three rapid clicks. Preview was ready about 21 s
   after opening; Frame completed about 16 s after the preparation checkpoint. Neither
   reported preparation toast appeared.
- A fresh run from the original PNG completed Sharp, commit, Preview and playback. Sharp's
   visible result took about 69 s on this machine during concurrent work; the retained
   geometry was unchanged. This verifies completion, not a fixed tracing-time guarantee.
- A permanent browser regression, `e2e/trace-sharp-output.e2e.ts`, covers import through
   simulated Frame using the existing dense dragon asset by default, with
  `SHARP_TRACE_IMAGE` selecting the original owl or another local dense PNG.
- The final combined original-owl run passed in 1.7 minutes: import through Sharp, commit,
  filled Preview, scrub/play/pause and simulated Frame after three clicks. Sharp was visible
  about 49 seconds after import, Preview about 16 seconds after commit, and Frame about
  14 seconds after its preparation checkpoint. There were no renderer crashes, page errors
  or either preparation toast. The committed trace still had 494,902 vertices.
- The same combined browser regression passed with the default dense dragon in 1.9 minutes
  (7,711 contours / 348,018 vertices), including Preview, playback and simulated Frame.

The first recorded browser baseline retained very large Playwright snapshots and attempted
to return the entire project over the debugger; it is not reliable crash-timing evidence.
A leaner baseline also stopped responding during preparation, but did not report the exact
Windows `STATUS_ACCESS_VIOLATION` code. The deterministic 4 GB compiler failure identifies
a concrete memory fault in this workflow without claiming every native browser crash has
the same cause. Successful browser runs disable retained trace snapshots, keep small stage
records, and capture screenshots.

## Verification

- Frame ownership/layout and stale-preparation tests: 13 passed.
- Idle-worker lifecycle, memory lane routing and existing canvas routing: 24 passed.
- First-process-point parity and existing canvas marker plans: 51 passed.
- Even-odd hatch boundary and surrounding hatch suites: 31 passed.
- Final fill compiler/cache, composition, bounds and timing integration: 45 passed in
  8 files, including the 150,000-contour test and source-boundary/shared-edge regressions.
- Additional fill, output preparation, Frame and JobControls regressions: 157 passed in
   35 files. These include the surrounding policies and failure paths.
- Production web build (including full source typecheck), E2E typecheck, repository-wide
  ESLint and formatting, file-size, export-count and ADR-number checks passed. The soft-size
  report completed; existing advisory-sized modules remain. The build reports its existing
  large-chunk advisory. The above test cohorts overlap; they are not a summed repository-wide
  total.

An unchanged trace-only dragon stress test has a strict 30-second end-to-end preview budget.
Its earlier audit run missed that deadline despite a successful 29.9-second trace worker.
That run is not a crash reproduction or a passing full E2E suite. The new output regression
allows long, heartbeating Sharp computation and verifies the downstream workflow as well.

Local diagnostic scripts, staged JSON, screenshots and the captured Sharp project are in
`artifacts/sharp-owl/` (ignored by Git). The original PNG was not modified or added to the
committed assets.

Final owl evidence:

- `artifacts/sharp-owl/final-owl/trace-sharp-output.e2e.ts--f6112-mpletes-one-simulated-Frame/sharp-output-evidence.json`
- `artifacts/sharp-owl/final-owl/trace-sharp-output.e2e.ts--f6112-mpletes-one-simulated-Frame/sharp-frame-complete.png`

Re-run the committed browser regression from this worktree:

```powershell
$env:SHARP_TRACE_IMAGE='C:\Users\Asus\Desktop\Owl.png'
$env:PLAYWRIGHT_PORT='5295'
pnpm exec playwright test e2e/trace-sharp-output.e2e.ts --output artifacts/sharp-owl/final
```

No real controller, air cut, material run, installed Electron package, hosted deployment,
or complete repository release gate was qualified by these checks.

## Review of concurrent Claude changes before publication

Reviewed the uncommitted Sharp/Frame patch in `.claude/worktrees/big-problem-47d443`, at
HEAD `377e692ba`, before creating this PR. The sibling image-trace worktree was clean on
the same main commit. The existing merged worker-heartbeat, bend-scan, packed-preview and
preparation-retention fixes remain part of this branch's base.

- The new trace policy would downsample the exact owl from 1254 x 1254 to 1118 x 1118:
  its measured mask transition density is 0.1225588094, above the proposed 0.025 gate.
  In a separate 2048 x 2048 dense hatching fixture with 32 isolated single-pixel marks,
  the proposed resampling and Sharp preprocessing retained 0 of the 32 marks. The current
  policy remains native. The proposed downsampling is excluded: it changes Sharp fidelity
  and is unnecessary for the verified native-resolution owl fix.
- The new Frame registry overlaps the ownership fix already tested here. An isolated
  exact-source proof found it starts work before reserving ownership, allowing two
  compilations on synchronous reentry. Changed-key replacement also allows unresolved
  jobs to overlap, retains an older progress value, and can clear the busy flag while an
  older request remains pending. This branch keeps one owner through Frame completion.
- Claude's progress text and `aria-busy` additions are optional UI changes. The proposed
  progress publisher has no request ownership binding; it was not copied. The Start-flow
  change is comment-only. No missing independent queue protection was found.

The reviewed files were fingerprinted before/after the independent probes and did not
change during review. Local evidence is in `artifacts/sharp-owl/claude-policy-review.json`
and `artifacts/sharp-owl/claude-review/`. The trace-policy SHA-256 was
`83dfb5590a706a0933d215f1e7fa72ca279fad132ed9aabeda1ea29a5a4e550d`.
Claude's checkout and the unrelated timing/inspector work in the primary checkout were
not edited or folded into this fix.
