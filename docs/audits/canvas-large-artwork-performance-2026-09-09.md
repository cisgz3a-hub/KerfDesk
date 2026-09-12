# Dense artwork and raster canvas responsiveness

Date: 2026-09-09. Baseline: `197a0956c84ceeedae025af5e260878b0b7c1e5f`
(the prior preset candidate `2613ff0deb884e8d3935f74df335e45997aafdd3` has
the same tree). This follow-up investigates ordinary Design interaction after
importing an image or committing a trace.

## Confirmed causes and changes

- Every ordinary pointer move published a fresh empty snap-guide array,
  invalidating the full artwork canvas. Equal ordered guides now retain state
  identity; changed or cleared guides still publish immediately.
- Explicitly closing each filled contour made Chrome repeatedly process the
  growing native path. Canvas `fill()` already implicitly closes its subpaths.
  Omitting those redundant closures retains the same vertices, transforms,
  contour order and fill rule. No tracing, stroke or display simplification
  policy changed.
- The UI's raster preparation policy allowed ordinary large embedded images
  to compile, resample and dither on the main thread for both ETA and idle
  markers. A separate 250,000 source-pixel plus effective-output-pixel-pass
  budget now routes that work through existing workers. This is scheduling,
  with no new image limit, output refusal or loss of source resolution.
- Large saved projects must schedule an initial background estimate. The
  estimate hook now also restores its mounted flag during development
  StrictMode effect replay, allowing valid worker results to publish.
- ETA requests previously constructed and copied a full preview route that
  the badge never used. On the 4096 x 4096 fixture this failed with
  `Data cannot be cloned, out of memory`. Estimate requests now return only
  the exact estimate, without building that route. Full Preview results can
  satisfy ETA; an estimate result cannot satisfy Preview. Both share the
  existing supersession queue and a global four-result cache bound, with only
  one reusable full Preview. A replacement releases the previous cached full
  route before transfer, and a late older result cannot restore that cache
  entry. Undo history retains Projects, so a weak per-Project cache alone
  would not release those generated routes.
  Full worker responses also retain their existing placement-offset carrier,
  which the client previously discarded.
- The full worker previously calculated its duration after retaining the
  complete route. In the committed production trial, stage diagnostics
  completed construction, scene mapping and serialization, then stalled
  inside that duration calculation. Calculate the same prepared-output
  estimate before constructing the route, avoiding that overlap in live
  memory. The ordinary estimate, source and path mathematics are unchanged.
- Full Preview must still receive its complete route. The ordinary 4096 x
  4096 raster rendered directly on the baseline but exhausted a single worker
  clone after background routing. Larger full responses therefore transfer
  ordered, acknowledged chunks of at most 2,048 steps, including the optional
  verified executable-plan route. Partial results remain private until counts,
  sequence and completion validate; cancellation and failures discard them.
  The worker consumes only its newly constructed response and releases each
  acknowledged portion of its private step arrays. This avoids retaining two
  full routes during transfer. Nested points, metadata and prepared output
  remain untouched, and the ordinary sender remains non-consuming.
  This is a record-count bound for the many small raster steps, not a
  universal byte bound on a single enormous polyline.
- Native worker cloning also expands ordinary raster records. In a controlled
  200,000-step Chrome comparison using the real raster builder and scene
  mapper, retained heap after collection was 36,432,580 bytes for local
  construction and 56,392,100 bytes after chunked worker transfer, 54.8% more.
  Explicit local record reconstruction with shared repeated strings reduced
  this to 34,421,720 bytes; exact JSON SHA-256 values matched in every case.
  Small heap snapshots confirmed duplicated kind, colour and source strings
  and larger cloned XY record bodies. Boxed-number allocations were unchanged.
  Reconstruct ordinary received raster records and intern equal strings per
  transfer; preserve rich or unsupported records on the existing object path.
  These are retained-heap measurements after collection, not a claim about
  the peak memory of the full application or universal browser limits.
- Scene-coordinate mapping allocated a second complete route. Streamed
  raster jobs already bypass executable-plan Preview verification, so their
  fresh machine-route array can be consumed by replacing each slot with the
  existing mapped step. Original step objects, shared points/polylines and
  metadata are untouched. Other jobs retain the pure mapper and original
  machine route for executable-plan parity. This removes the overlapping
  route arrays during mapping; it does not prove a retained original route
  was the cause of the later autosave failure.
- The autosave hook added a fresh job-setup wrapper on every tick, defeating
  the existing unchanged-project memo. A per-mounted-loop snapshot memo now
  includes document epoch, placement, output scope and ordered selection.
  Dirty/streaming checks, slot-generation invalidation and durable ownership
  remain in force.
- Recovery JSON omits indentation while manual files keep their existing
  formatting. For the exact dense trace, recovery JSON fell from 65,849,754
  to 19,687,158 bytes (70.1% smaller). Three alternating native comparisons
  gave median serialization plus validation of 624 ms versus 470 ms. Every
  source coordinate and manual-save byte remained identical; these native
  measurements exclude the retained raster and do not establish browser
  first-save latency.
- Raster validation now checks canonical Base64 alphabet, padding, unused
  bits and decoded byte count in one pass without allocating a cleaned or
  decoded copy. Existing accepted whitespace and error text are preserved.
- Required recovery serialization and validation now run in a short-lived
  worker inside the existing durable write queue. Epoch, clear, session,
  fallback and commit ordering remain covered by focused regressions.
- Preview status, distance totals and pass boundaries were also recomputed
  on unrelated cursor updates. Memoize those derived results by their actual
  project and route inputs; meaningful changes still invalidate them.
- Dense Preview painting uses an OffscreenCanvas worker for the existing
  selected display commands. The client retains one image, one in-flight
  render and the newest requested view. It shows `Updating route view…`
  while transforming an older matching-content image during interaction.
  Settled images preserve the previous renderer's widths, dashes and order.
  The worker paints over a captured underlay to preserve individual stroke
  alpha blending, and the result is copied back before outlines and rulers.
  Route/background changes, worker errors and Preview exit release obsolete
  images and worker state. Source geometry and display sampling are unchanged.
  Continuous playback retains the latest completed progress image of the
  same route/travel/background while the next frame renders. Exact readiness
  still requires the latest scrubber value, view and size. This prevents
  repeated progress updates from discarding every reply and blanking Preview.

## Paired browser evidence

Local Windows, headless installed Chrome 152, 1920 x 1080 viewport, device
scale factor 1, real application imports, workers and canvas interactions.
CPU profiles and frame samples come from the same scripted sequence. Samples
exclude debugger start/stop overhead. Absolute timings depend on hardware
and profiling overhead; these are observed comparisons, not universal FPS
guarantees.

The exact dragon PNG is the checked-in
`src/__fixtures__/perceptual/assets/centerline-stress-test-20260909.png`, SHA-256
`e4b23a55c73c679b81889ac86a07efccd62039619b9758d63a96ca492032f846`.
Default Line Art produces 1,804 polylines / 197,421 source vertices. The
existing display policy uses 99,625 vertices; this change does not alter it.

| Full application interaction | Baseline P95 frame interval | Initial fixed candidate |
| --- | ---: | ---: |
| 80 pointer moves after Line Art trace | 324.9 ms | 8.5 ms |
| Six zoom button clicks after trace | 266.5 ms | 24.8 ms |
| 24 middle-button pan moves after trace | 283.3 ms | 24.9 ms |

The baseline hover phase contained 82 long tasks; explicit `closePath`
accounted for 23.2 seconds of CPU self time. The fixed zoom and pan phases
had no long tasks. The initial fixed hover phase still included the first
required autosave (600 ms), which is distinct from the removed repeated
redraws and unchanged autosaves.

A later production-bundle profile with compact autosave and the estimate-only
worker returned P95 intervals of **8.5 ms for hover, 16.6 ms for zoom and
25.0 ms for pan**. Those measured interaction phases contained no long tasks;
their maximum intervals were 16.8, 33.4 and 25.1 ms respectively. The trace
commit phase still included a 283 ms task. This profile qualifies the frozen
canvas/autosave sources; its recorded bundle/source hashes precede the final
large-Preview memory changes. It does not establish a worst-case
bound for the first required autosave, including work between measured phases.

An isolated native Canvas2D comparison of the actual original and modified
functions produced **54/54 pixel-identical RGBA results**. Cases include the
dragon, nested/open/self-crossing/degenerate contours, both fill rules,
nonuniform and negative transforms, context matrices, stroke styles and
alpha. Warm dense fill submission fell from 255.9–272.1 ms to 3.3–4.0 ms;
including forced raster readback it fell from 282.0–296.8 ms to 27.8–32.2 ms.
These isolated numbers are separate from the full application measurements.

The later Preview worker matches the previous production renderer in
**75/75 native Chrome 153 cases**, with all **29,491,200 RGBA channels** equal.
Cases cover dense intersections, partial progress, travel visibility,
endpoints, the existing 120,000-step/long-polyline display boundaries and
actual background/outlines/rulers. An initial transparent-layer approach
changed overlapping alpha values; capturing the actual underlay eliminated
those differences. This is settled-frame pixel evidence, separate from
full-application interaction and memory qualification.

Production testing on 2026-09-12 still reproduces a V8 memory failure when the
normal 30-second autosave overlaps the 4096-image Preview transfer. A run
whose autosave completed before transfer received every step and achieved
Preview hover P95 8.5 ms, but this timing avoided the failing overlap and
does not qualify it. The native renderer dump reports exception
`0xE0000008` and `v8-oom-location=CALL_AND_RETRY_LAST`; the memory
investigation is retained with the external evidence. The matching Chrome
153 V8 HeapStats layout identifies a 4 GiB pointer-compression cage shared by
five isolates. The first dump has 133 MiB free but a largest free region of
13.5 MiB; the failing worker has only about 12.2 MiB live heap. A second dump
after owned mapping reports the same reservation failure on the main
thread, with 501.5 MiB free but a largest free region of 22.25 MiB. Both
dumps are from this same host, with roughly 8 GB of
system commit available; this is not a claim that Windows exhausted RAM.
Owned mapping alone does not solve the overlapping worker lifetimes.
Interpretation uses the exact Chrome 153 V8 revision's
[heap statistics](https://chromium.googlesource.com/v8/v8/+/f343157cebb388bfa416baccb5d35507e6fe8cc7/src/heap/heap.cc#5123)
and [reservation status definitions](https://chromium.googlesource.com/v8/v8/+/f343157cebb388bfa416baccb5d35507e6fe8cc7/src/base/bounded-page-allocator.h#61).

Preparation and autosave now reserve one FIFO memory lane before worker
construction or cloning. A terminal preparation retires its worker before
releasing the lane. Autosave keeps its normal interval and snapshot but
waits for active preparation to finish; later preparation requests cannot
overtake it. Completed result caching and current-queue coalescing remain.
The production browser now completes all 7,305,177 route steps at 48.3 seconds,
retires preparation and then commits the queued normal autosave at 50.1 seconds.
The 30-second autosave tick occurs during transfer. Recovery retains the exact
4096 x 4096 PNG and all 16,777,216 luminance bytes, with matching SHA-256 hashes;
this run has no page or worker error or renderer crash. This is native evidence
for this fixture, not a guarantee of every browser's memory reclamation timing.
Hover and Design zoom/pan have 8.5 ms frame P95, but Preview zoom/pan still have
100/150 ms P95, requiring the display scheduling changes below.

The follow-up transfers exact display coordinates and ordered commands in two
owned buffers, avoiding the object graph clone during playback. A completed
Preview image follows pan/zoom immediately, with exact viewport repaint after a
150 ms quiet period. This brings native full-image Preview hover/zoom/pan P95 to
8.5/8.4/8.5 ms. Playback still stalls on repeated dense GPU frames, despite removing
repeated main-thread clone tasks. Progress changes therefore use a separate
CPU-backed worker canvas temporarily. After 150 ms of quiet progress, the same
commands are painted by the original GPU context. Interim antialiasing can differ;
the updating indicator remains until the exact final GPU view arrives. Worker
ownership remains bounded to two viewport canvases and one decoded command frame.
The final production run completes transfer at **52.18 seconds** and commits
the queued autosave at **53.81 seconds**; the normal tick occurs at 30.29 seconds,
during transfer. All seven interaction checks pass in native Chrome 153.0.8010.37:

| Interaction | Frame P95 | Maximum frame interval |
| --- | ---: | ---: |
| Preview hover | 8.5 ms | 8.6 ms |
| Preview zoom | 8.5 ms | 108.3 ms |
| Preview pan | 8.5 ms | 8.5 ms |
| Design hover | 8.4 ms | 16.8 ms |
| Design zoom | 8.4 ms | 8.5 ms |
| Design pan | 8.4 ms | 8.5 ms |
| Preview playback | 8.5 ms | 150.0 ms |

Each hover delivers 48 actual canvas pointer moves with zero canvas redraws.
Playback remains visible throughout, with 267 bitmap blits during the measured
phase. Its two main-thread long tasks are 50 and 152 ms; the initial progress
calculation and occasional exact GPU repaint can still cause finite pauses.
P95 here measures page frame responsiveness, not the rate of newly computed
route images. Source image and luminance hashes match the earlier exact values,
and there are no page, worker or Preview errors. This qualifies the full-image
workflow on this host, not arbitrary input sizes or every browser/GPU.

The native CPU-to-GPU restoration matrix also passes all 75 cases: each final
GPU frame reuses the CPU frame's decoded geometry without retransmitting it,
and all 29,491,200 RGBA channels match the old renderer. The CPU stage exercises
the known transient antialiasing differences. Both transferred coordinate buffers
and all 150 underlays demonstrably detach; no source geometry is detached.

The same 4096 x 4096 gradient/crossing-line raster now completes its real
background ETA at **48,441.177515398085 seconds**, displaying **13h 27m 21s**,
the same label as the original synchronous calculation. The response contains
the estimate and no unused toolpath; the idle-marker worker also succeeds.
A development-server full Preview completes all **7,305,177 steps** across 3,567 chunks,
with cut/travel/total distances of **490,605.5 / 714,133.4 / 1,204,738.9 mm**
and the same time breakdown as the baseline. Play is enabled and no worker,
page or Preview errors occur. Observed Preview preparation took 46.2 seconds;
the earlier synchronous baseline took 24.8 seconds. The background transfer
trades total preparation time for responsiveness and avoids the observed
clone failure. This completion check is separate from interaction profiling.
A smaller transformed, two-pass raster matches direct preparation for the
full route, nonzero placement offset, estimate, markers, preflight and all
11,599 emitted G-code bytes. Emission here is an in-memory comparison only.

## Regression coverage and evidence location

Focused regressions cover no-op guide notifications versus real guide
changes, dense contour construction and fill rules, effective raster
operations/output scope, initial and StrictMode worker completion, autosave
snapshot identity/invalidation, and Base64 grammar compatibility. The Base64
comparison includes exhaustive short inputs, 10,000 deterministic malformed
strings, canonical encoded data and a 1 MiB raster.

Browser regressions commit every default trace preset, compare the saved
geometry with actual worker output, then require twelve native hover moves
to produce zero artwork redraws. All five defaults and native trace
supersession pass on the development server. The 600 x 2400 raster regression
requires actual ETA, non-null idle markers and completed chunked full Preview,
then checks zero hover redraws in both Design and Preview and verifies saved
source dimensions and pixels. This case passes in native Chrome. The hover
regression failed on the baseline with twelve redraws.
Hover points are hit-tested against the actual canvas: on a compact viewport,
the Preview controls cover part of its rectangle. Both 1280 x 720 and
1920 x 1080 viewports must still deliver all twelve native canvas pointer
events and zero artwork redraws, rather than silently hovering a control.

Raw profiles, scripts, screenshots, source hashes, native pixel comparisons
and reports are retained outside the repository at
`C:/Users/Asus/.codex/audits/canvas-large-artwork-20260909/`.

Initial image decoding, trace commit and required persistence can still
produce finite pauses. No controller connection, Frame, Start, streaming or
hardware operation was performed. These results qualify browser behavior
and source preservation, not physical output or a packaged desktop runtime.
