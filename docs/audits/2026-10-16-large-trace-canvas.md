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
2. **A separate sprite admission bug remains on current main.** A zoomed dense
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

### Full-application qualification still required

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

This is a source repair. It has not been merged, published, installed or qualified
in the user's packaged desktop. No controller or hardware was operated.
