# Large-trace canvas navigation investigation, 16 October 2026

The reported surface is the installed Windows app's main workspace while moving,
panning and zooming after a large trace. The investigation starts from current
`origin/main`, `f7e2a36895b67cfa33be03c16e6c19e7c6722d14`, in the isolated
`codex/large-trace-canvas-20261016` worktree. The old, dirty primary checkout was
left intact.

## Confirmed findings

1. **The installed desktop predates the last performance fixes.** The desktop
   shortcut resolves to `C:\Users\Asus\Desktop\KerfDesk\KerfDesk.exe`, version
   1.0.18. Its `resources/app.asar` package records source
   `6abbe396c9176514389ea1114acbaa7cae534d01` in the release identity. The worker
   transfer, scheduling and sprite residency repairs in commit `f73736102`
   (PR #1206) are later than that installed source. The package metadata was read
   locally; this is not a new signature-verification or installed-app interaction
   qualification.
2. **A separate sprite admission bug existed on the initial baseline.** A zoomed dense
   object is supposed to render once into a bitmap covering the viewport and a
   25% margin on each side. Those margins already use 2.25 times the viewport's
   pixels, exactly the configured pixel cap for larger canvases. Adding three
   pixels of padding on every bitmap edge exceeds the cap. Admission then fails,
   and every pan, zoom or artwork move can repaint all display vectors directly.
   The minimum four-million-pixel cap masks this on smaller canvases. The canvas
   uses CSS dimensions, so this is a viewport-size issue, not specifically a
   Windows display-scaling issue.

## Fix

`src/ui/workspace/artwork-sprite-cache.ts` first preserves the existing full
object and clipped-region choices when they fit. If the padded clipped region
does not fit, it reduces only the optional margin to reserve padding, outward
rounding and the 8192-pixel side limit. It keeps the full visible viewport.
Budget validation now uses the same ceiled dimensions as bitmap allocation.

The memory cap, source geometry, selection and output paths are unchanged.
Pan and artwork translation reuse the sprite; zoom retains the existing
placeholder policy and exact repaint after settling. An actually oversized
viewport still falls back to direct painting rather than omit visible artwork.

## Research basis

- [MDN: Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
  recommends pre-rendering repeated objects and reusing their pixels. KerfDesk
  already implements that strategy; correcting the admission calculation restores
  it for the affected windows.
- [MDN: Path2D](https://developer.mozilla.org/en-US/docs/Web/API/Path2D) describes
  reusable paths. Retaining paths avoids rebuilding commands but does not itself
  remove repeated rasterisation, which is why a retained bitmap is useful here.
- [web.dev: OffscreenCanvas](https://web.dev/articles/offscreen-canvas) explains
  moving canvas work to a worker to reduce main-thread contention. A worker-owned
  renderer remains a possible wider change; it is not necessary to correct this
  reproduced cache failure.

## Verification and limits

The new cache admission regression initially failed in six viewport cases.
With the fix, both sprite suites pass **25 tests**. Cases include 1920x1080,
2560x1440, 3840x2160, odd dimensions, ultrawide and portrait viewports,
fractional pan/zoom, complete viewport coverage, exact settled rendering and
fallback at the hard side limit.

The standalone paired probe passes using the application's current `drawScene`
and display-resolution code in native Chrome, with only the cache implementation
swapped between baseline and candidate. The deterministic fixture has 180,000
source points in 1,500 closed contours, assigned to one Fill operation. Across
12 samples of each interaction at each size, baseline falls back to direct vector
drawing **72/72 times**. The candidate serves **72/72 cache hits**, with no dense
repaints during these warm interactions.

Median synchronous `drawScene` submission time, milliseconds:

| Canvas | Interaction | Baseline | Fixed |
| --- | --- | ---: | ---: |
| 1920x1080 | Pan | 13.5 | 1.2 |
| 1920x1080 | Zoom | 11.1 | 0.9 |
| 1920x1080 | Move artwork | 12.1 | 0.9 |
| 3840x2160 | Pan | 35.3 | 1.4 |
| 3840x2160 | Zoom | 34.6 | 1.7 |
| 3840x2160 | Move artwork | 33.5 | 1.4 |

These are diagnostic CPU submission timings on a shared, busy Windows host,
not displayed frame rates. Frame scheduling still has outliers, including a
291.6 ms interval in the candidate 4K run. The probe uses native Canvas2D but
does not run the full React app or installed Electron package.

The exact project hash, including source geometry, operation settings and
transforms, remains
`dd29f7b368d84add19a517ef1b41dc74006eda12d39a1c35d5409acc7f87a055`.
Emitted G-code is not recomputed by this rendering probe. Settled screenshots
show the same artwork; 81 pixels at 1080p and 2,172 pixels at 4K differ in edge
antialiasing (0.00391% and 0.0262% respectively), with no alpha changes. Exact
pixel identity is not claimed.

Reproduce with an explicit pre-fix baseline (required; there is no default):

```powershell
node scripts/performance-audit/large-trace-canvas-probe.mjs --baseline=f7e2a36895b67cfa33be03c16e6c19e7c6722d14
```

The candidate comes from the current working tree. Choose a baseline whose cache
source differs from the candidate; an explicit but identical baseline is rejected.
Use `--help` for options. To verify source selection and bundling without running
the renderer measurements:

```powershell
node scripts/performance-audit/large-trace-canvas-probe.mjs --baseline=f7e2a36895b67cfa33be03c16e6c19e7c6722d14 --compile-only
```

Compile-only output reports the resolved baseline commit and both source hashes.
It does not establish browser timing or visual correctness.

Local measurement receipt and paired screenshots:
`artifacts/large-trace-canvas/2026-10-15T16-47-48.692Z/receipt.json`.

### Initial qualification attempts (superseded by the follow-up below)

The initial full-app attempt using the actual 1254x1254 dragon PNG did not
complete tracing within the 240-second test budget, with either Sharp or
Line Art. A subsequent attempt starting from completed synthetic trace geometry
timed out in `page.goto`, while the app still displayed its loading screen. It
never installed the fixture or measured navigation. The shared host was running
other substantial jobs; these attempts establish neither a navigation failure
nor a passing full-app result.

`e2e/dense-trace-canvas-navigation.e2e.ts` is retained as an **opt-in diagnostic**
for an uncongested host. It installs 180,000 points, disables the fixture's output
to avoid competing ETA preparation, counts bitmap versus direct line drawing on
the visible canvas, and checks that source paths remain unchanged. The separate
paired probe above also counts offscreen sprite paints. The opt-in diagnostic's
final setup has not passed a full execution here:

```powershell
$env:KERFDESK_DENSE_CANVAS_AUDIT = '1'
pnpm exec playwright test e2e/dense-trace-canvas-navigation.e2e.ts
```

The repository-wide type-check attempt was stopped after prolonged resource
contention. A focused check initially reported existing `findLastIndex` uses in
`src/core/job/motion-manifest-parser.ts` against the repository's ES2022 library
setting. Those calls are present in the unchanged baseline. The temporary focused
validation config adds `ES2023.Array`; the focused check then passes. Production
configuration is unchanged. Repository ESLint rules pass on both changed source
files and the opt-in diagnostic (zero errors or warnings), using that focused
TypeScript project. Both probe scripts pass ESLint and Node syntax checks.
Formatting, whitespace and the file-size backstop pass. No repository-wide
type-check or full test-suite pass is claimed.

Delivery requires a new Windows build containing both PR #1206 and this repair,
followed by pan, zoom and artwork-move verification with a real large trace in
that packaged app. That is the remaining step before calling the installed
desktop fixed.

At that initial handoff this was an unmerged source repair, without packaged
qualification. No controller or hardware was operated.

## Windows follow-up, 16 October 2026

PR #1213 merged the cache repair while this follow-up was in progress. The
worktree incorporated `origin/main` at `ef63765d8`; merge commit `c0c179015` has
the same tracked source as that upstream commit. This follow-up changes tests,
diagnostic scripts and this report only. It introduces no shipped runtime hook.

### Checks and build

- Full `pnpm typecheck` and `pnpm typecheck:e2e` pass. The earlier focused
  ES2023 workaround is unnecessary with the complete TypeScript program.
- Cache and draw-scene suites: 53 tests across 15 files pass.
- The opt-in full-app test now passes all three gestures at 3840x2160, with a
  6,111,396-pixel canvas, 1,500 contours and 180,000 points. Pan, zoom and move
  produce respectively 12, 6 and 12 bitmap draws. Source paths are unchanged;
  movement changes translation and Undo restores it.
- Five packaged-probe tests, scoped ESLint, formatting and file-size checks pass.
- Electron main, production desktop renderer and Windows x64 NSIS builds pass.
  `verify-packaged-desktop.mjs` confirms executable fuses and archive contents.
- The separate packaged native smoke passes launch, isolated profile, sandbox,
  context isolation, absent renderer Node primitives, SVG import and save. Its
  picker is stubbed and its save is in memory; it is separate from the real UI
  checks below. Receipt: `artifacts/native-smoke-auto/run-kqPacz/manifest.json`.

The unsigned local validation installer is
`artifacts/windows-canvas-package/KerfDesk-0.1.0-windows-x64-setup.exe`.
It is a Free test package, not a commercial release or an update to the user's
installed app. Renderer build identity is `c0c17901`, version `0.1.3526`;
package version is `0.1.0`, Electron `44.5.1`.

| Artifact | SHA-256 |
| --- | --- |
| Installer | `6b4b844fb8716ac9bfcedfe552ecea0d5d225bd5bc0e871a8f91da88221797aa` |
| app.asar | `8907f5f8803663179ca9f225b33ea86cca506dd51326c22b5fdac1e41d77298c` |

### Real trace in the packaged Windows app

The package was launched with a fresh isolated profile. Windows UI input opened
the repository's `centerline-stress-test-20260909.png` (1254x1254), selected Line
Art, and committed the ready trace. The preview reported **3,302 paths and
30,085 nodes**. The saved project contains 3,302 polylines with 58,219 display
points and 3,302 curve entries. Output remained enabled; no hardware was connected
or operated.

The maximized workspace canvas was **2762x1740 CSS pixels**, with an explicitly
chosen test device scale factor of 0.75. Native Windows wheel input zoomed from
230% through 371% to 759%, exercising a large clipped view. Windows input also
dragged the artwork and used Undo. The 12-step middle-button pan used the existing
Free/Preview CDP test connection and is explicitly labelled CDP-injected input.

| Gesture | Observed result | Timing limit |
| --- | --- | --- |
| Pan at 759% | 12 bitmap draws; no new long tasks | All 72 new navigation rAF intervals were at most 16.67 ms over a 618 ms measurement |
| Native artwork move | Translation changed by about 3.81 mm X and 1.59 mm Y; cached bitmap draw observed | One pressed movement event was sampled; maximum navigation interval 66.8 ms; two long tasks, maximum 61 ms |
| Native zoom | View changed correctly; bitmap draws observed | Two long tasks of 252 and 269 ms remain across the large zoom changes |

Non-workspace canvas commands during the pan exactly match compact Frame/Job
marker rendering (8 lines, 5 strokes and 1 fill per frame). They are consistent
with sprite reuse, but aggregate counters alone do not prove zero sprite paints.
The observer records main-renderer canvases; worker canvases and actual display
presentation are excluded. rAF intervals are scheduling measurements, not FPS.

Native Save wrote actual `.lf2` files before movement, after movement and after
Undo. All three have the same source-path SHA-256:
`e5d350686be63f355c1c9cda302e549d26e540bfdccabe3f2ab917e535e72de6`.
The moved transform differs and the Undo transform exactly matches the original.
The receipt is `artifacts/native-trace-navigation/geometry-comparison.json`.

Other local receipts in that directory are:

- `2026-10-15T23-38-06.018Z-snapshot.json`: ready real-trace counts.
- `2026-10-15T23-40-18.454Z-snapshot.json`: both native wheel zooms.
- `2026-10-15T23-40-36.979Z-pan.json`: before/after pan measurements.
- `2026-10-15T23-41-14.032Z-snapshot.json`: native artwork move.
- `ready.json`: packaged runtime and isolated-profile evidence.

**Verdict:** the large-canvas pan repair is validated on this real trace, and
move/zoom/Undo function correctly. The remaining zoom pauses prevent a claim
that all post-trace lag is fixed. Sustained native drag timing is not qualified
by the single short Windows drag; the full-app regression separately exercises
12 movement steps. The user's installed 1.0.18 app was not replaced or modified.

### Repeating the packaged diagnostic

Use a separately launched isolated Free/Preview package, its actual main-process
PID and loopback CDP port. Commercial packages refuse this path. The helper
verifies PID, packaged origin and Free channel, and creates no new browser tabs.

```powershell
node scripts/performance-audit/packaged-trace-navigation.mjs --mode=install --endpoint=http://127.0.0.1:PORT --expected-pid=PID --executable=ABSOLUTE_EXE --output=ABSOLUTE_DIRECTORY --expected-profile=ABSOLUTE_PROFILE --isolation-root=ABSOLUTE_EVIDENCE_ROOT
```

Use `reset` immediately before a Windows gesture and `snapshot` afterward.
Use `pan` for the bounded CDP middle-drag, whose receipt contains before/after
counters; subtract them instead of reporting cumulative earlier zoom activity.
The helper disconnects without closing the app. The final observer filters
queued long tasks predating reset; the recorded native run used the earlier
observer before that hardening, with long idle gaps before resets. Preserve that
measurement-version distinction when comparing future runs.

### Diagnostic ownership hardening after the recorded run

The follow-up helper now requires `--expected-profile=ABSOLUTE_PROFILE` and
`--isolation-root=ABSOLUTE_EVIDENCE_ROOT`. It accepts only a separately launched
Windows Free interactive observation package using the existing
`--kerfdesk-native-smoke-interactive`, `--kerfdesk-native-smoke-user-data=...`
and `--kerfdesk-native-smoke-result=...` options. Quote the entire argument when
its value contains spaces. The profile and native result must already exist
inside the explicit isolated evidence directory, outside ordinary roaming app
data. The helper checks canonical paths (including junction targets), the OS
process executable/start time/command line, the current launch's native
userData/sessionData receipt and the CDP browser PID before instrumentation.
It rechecks ownership before acting and before accepting a result.

The native measurements above used the earlier helper, not this strengthened
ownership guard. These new guard tests are source-level qualification; they do
not retrospectively qualify the earlier run or the user's installed desktop.
