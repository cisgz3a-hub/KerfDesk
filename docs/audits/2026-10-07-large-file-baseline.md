# Fixed large-file engine baseline

`node scripts/large-file-bench.mjs --runs 3 --out <report.json>` runs two versioned,
synthetic inputs without private artwork or downloads. It records input/output
SHA-256, the compiled engine hash, Git HEAD and dirty state, runtime and machine
metadata, one warmup, and each measured trial. Fixture tests pin the version-1
input hashes. A changed fixture needs a new version before comparing reports.

This harness measures the worker SVG parser and pure-core Line Art tracing.
Input generation and output hashing happen outside measured intervals. Source-file
decoding, browser rendering, UI interaction, CAM, transport and material work are
outside its scope. RSS before/after observations include the process and retained
allocations; they are not peak memory. It performs no hardware operation.

## Observed local run, 7 October 2026

The first baseline ran on Windows x64, Node 24.15.0, during the parallel workflow
audit. HEAD was `76b5ff53e3be7df6c160a8b26820e61188595f08`; the working tree had
uncommitted changes. Compiled engine SHA-256:
`89e3258d0ff958f87415aa894d457521bfe40d61221af6966efe941e9423ddb5`.

| Fixed input | Source size | Output | Three trials, ms | Median, ms |
| --- | ---: | --- | --- | ---: |
| SVG with 50,000 closed contours | 3,739,487 bytes | 50,000 polylines | 931.3, 599.6, 564.8 | 599.6 |
| Sparse 4096 × 4096 opaque RGBA | 67,108,864 bytes | 10 polylines | 2527.3, 2528.8, 2529.2 | 2528.8 |

Each input produced an identical output hash across all measured trials. The
report is locally cached in `node_modules/.cache/kerfdesk-large-file-baseline.json`.
The initial report predates the added CPU/RAM/OS fields; future runs also record
those fields. These observations establish a reproducible local baseline, not a
competitor ranking, a UI responsiveness result, or a burn-quality result. Compare
future reports on the same fixture hashes, runtime, machine and workload, and
check output hashes before interpreting a timing difference.

## Browser import-to-output component pipeline

`node scripts/large-file-browser-bench.mjs --runs 3 --out <report.json>` uses the
installed Chrome through Playwright. It fulfils compiled repository modules at
an isolated synthetic origin, without a local server, installation, hardware or
real network requests. The original fixed SVG and RGBA fixtures remain unchanged.
A canonical 1-bit PNG preserves every opaque binary source pixel; its 2,101,476
encoded bytes are pinned independently of a platform compression encoder.
The same original pixels also have a canonical 67,118,148-byte RGBA PNG. This
variant crosses the 25 MiB page-backing boundary and exercises the native PNG
import worker, IndexedDB asset staging, source luma hydration and original-file
asset reading before the same tracing and output pipeline.

The SVG path includes native document import worker reading and parsing,
fragment hydration, CAM preparation, G-code generation and parsing, preview route
construction, and native canvas paint/readback. The bitmap path includes the real
image import action and browser decode, trace source read, shared preview
preparation/worker, SVG presentation, finer commit decode/worker, vector CAM,
bitmap conversion worker, raster CAM, both preview paints and both generated
programs. Every measured trial must retain identical output hashes and counts.

The fixed reference profile is generic GRBL v1.1 with a 600 mm square bed,
1,000 mm/min, 50% power, threshold raster at 10 lines/mm, source-order travel,
inside-first off and drawn contour starts. The bitmap initially imports at its
normal 254 DPI (409.6 mm square), then the fixture applies a declared 31.25%
placement to 128 mm square. Its original 4096 × 4096 pixels and file bytes remain
unchanged. Commit planning receives a fixed 8 GB device memory value.

An initial trial at the original 409.6 mm placement reached the existing bitmap
conversion limit: 3300 × 3590 output pixels planned about 363 MB, above the
64 MB conversion budget. The 128 mm fixture exercises both output modes within
that budget. This capacity limit remains part of the evidence; it was not raised.

This is a browser **component pipeline** benchmark. It excludes fixture
generation, initial module load, output hashing, OS file chooser/disk latency,
full application interaction, controller transfer, physical motion and material
quality. Canvas readback and animation frames provide native rendering evidence,
not a complete UI responsiveness or peak-memory measurement.

The retained [JSON report](2026-10-07-browser-component-pipeline.json) records the
7 October 2026 run at 03:40 UTC, Chrome 153.0.8010.53, Node 24.15.0, Windows x64,
Intel i9-13900H (20 logical processors), about 34.0 GB RAM, base HEAD `76b5ff53`
with uncommitted audit work, and hashes of every compiled harness/worker module.
Other audit checks ran concurrently, so these timings include machine workload.

| Fixed original input | Pipeline output | Median over three trials |
| --- | --- | ---: |
| 50,000-contour SVG, 3,739,487 bytes | 50,000 imported contours, native fill program and painted route | 5,674.4 ms |
| 4096 × 4096 PNG, 2,101,476 encoded bytes | Embedded pixels; 2048 preview, 2559 commit, 10 contours, vector and raster programs | 4,334.0 ms |
| Same original pixels in 67,118,148-byte RGBA PNG | Paged IndexedDB import/source hydration; same preview, commit and programs | 5,467.9 ms |

The bitmap trace rasterized to 1032 × 1122 pixels. Vector output was 7,347 bytes
and 360 lines; raster output was 37,815 bytes and 2,879 lines. Both preflight issue
lists were empty, and trace notices were empty. Native document import, trace and
bitmap conversion workers loaded in the isolated browser. Input/output hashes,
per-phase timings and all trial counts are in the JSON report.
The large PNG also loaded the native PNG import worker, and its recorded storage
was `paged-indexeddb`. Embedded and paged variants produced identical trace
geometry and both G-code hashes, verified independently from the final report.

The SVG's native black fill imports with a Fill operation override, which this
harness retains even though the reference layer is Line. Its default scanline
fill uses 0.1 mm spacing and 5 mm overscan, producing 675,693 route steps and a
5,955,318-byte program (675,704 lines). Six out-of-bed advisories are recorded for
that edge-placed artwork's scan runways. Those warnings remain visible; generated
bytes are computational evidence and were never sent to a machine.

Before timing, a separate native PNG/canvas check compared all 4,096 pixels of
a masked 64 × 64 source and its encoded comparison image with the engraving
compiler's mask pixel test. All pixels matched, including 2,048 masked pixels;
original file SHA-256 and the native clip reference remained unchanged. Local
regressions additionally cover transformed external masks, native holes, crop,
Invert, open paths, curve retention and rasterized trace engraving.

These results are a reproducible local baseline. They do not rank competitor
speed or physical burn quality. Compare reports only with matching original
fixtures, placement, settings, module hashes, runtime and machine workload.
