# Combined LightBurn feature and workspace audit remediation

Local integration owner: `codex/lightburn-audit-fixes-20260923` in
`D:\LaserForge\lightburn-audit-fixes-20260923`.
Base: `90c791c5f0d4a6b6d7b25901d250e3f4f42c46e8`.

This report covers the five priority feature/output corrections and the companion task's 13
workspace findings. Pass-through is shared by both lists and has one canonical implementation.
The initial LightBurn audit and live-workspace evidence remain unchanged under
`D:\LaserForge\audits\2026-09-23-lightburn-feature-gaps` and
`D:\LaserForge\audits\2026-09-23-live-ux`.

## Scope and ownership

| Work | Implemented behaviour | Original recoverable commit |
| --- | --- | --- |
| SVG artwork export | Selection or scene; millimetres, native curves/transforms, outlined text, embedded source images/masks; async capture; no production cursor advance | `7cdd4f24` |
| Laser overlap removal | Default-off Cut Planner option, emitted-precision interval removal within one settings group, independent operations/passes retained | `5bc4a0976` |
| Vector repair | Explicit chosen-operation silhouette union and compatible cross-artwork Join; canonical curves, tabs, ambiguity and undo | `fb4f5a4bdbab0beef92f2b60d92492abb2d1974e` |
| Pass-through | Shared original-grid/luma processing for compiler, stream, bitmap/export and popup; process power and dot width retained | `612cb4419bf92356043b6564b49333fe859497e6` |
| Variable Grid copies | Persisted copy offsets, one clock, measured initial layout, scoped successful-output advancement and schema 8 | `c17ba9c74e7b32f95c3d637642a59323ba098bd6` |
| Workspace refinements | Menu input, pressed-state contrast, essentials, markers/freshness, preview dock, restrained styling, save state, rounded area, node hint, names/units and first-use entry | Final integration record below |

Individual feature branches and the workspace-refinement branch are retained. The dirty primary
checkout is not the integration location and was not reset, cleaned or staged.

## Independent review follow-ups

- SVG masks must use the raster mask's global even-odd region, including nested rings stored in
  different colour paths; separate SVG clip children would incorrectly fill the hole.
- SVG number serialization must retain small transform coefficients and local coordinate detail;
  six-decimal local rounding can change a valid 12.7 mm edge to 12.5 mm.
- Adjust Image needs the actual maximum power, not an assumed 100%, for the same grey-level
  preview as bitmap export. Zero maximum power must remain unpowered.
- Variable advancement remains well-defined at the largest valid persisted sequence offset:
  validation and evaluation exclude unsafe `MAX_SAFE_INTEGER` offsets, and the largest accepted
  offset plus one is explicitly covered through serial and CSV wrap.
- New vector commands belong with the existing Vector menu group. File help was extracted to
  retain the repository's source-size limit after integrating new commands.

## Evidence and status

Integration verification is in progress. Final commit IDs, check totals and local browser evidence
will be recorded here after the combined source is stable.

The component lanes already cover geometry area/perimeter and transformed curves, ownership,
undo/save/reopen, final emitted overlap spans, materialized/streamed image bytes, processed PNG,
SVG serialization and write failures, variable layout/persistence and successful/cancelled/partial
G-code, Ruida and tile output. These are software tests.

Follow-up commits: `d15da5390d21d7b82999d5e814e30f2e86cd3182` adds image-power preview parity
and complementary output checks; `886c367fdc1700d7dff018d4a1c6c95dcfba2778` fixes SVG masks and
numeric precision. The SVG review passed 20 focused tests; the raster follow-up passed 80.

The preliminary workspace full-suite run used its own source snapshot: 2,327 files passed,
11 failed and 14 skipped; 16,444 tests passed, 15 failed and 22 skipped. Two failures were fixed
during that run and passed focused reruns; the remaining nine suites passed all 66 tests in a
single-worker rerun with unchanged timeout limits (106.07 seconds). Those component results are
not represented as a green combined suite.

Local smoke so far confirmed silhouette union changes two sample rectangles into one result and
Undo restores both; Remove overlapping lines starts unchecked and remains checked after Apply;
the SVG command is reachable from File. Browser file-picker write completion was not observed;
the SVG write/cancel/error boundaries are tested through the platform adapter.

## Deliberate limits

- The current SVG importer ignores embedded raster images. Standard SVG image export supports
  external editors, while the native project format preserves complete editable project data.
- Join leaves incompatible ownership, ambiguous junctions and manually tabbed contours unchanged.
  Overlap removal preserves separate compiled operations and pass counts by design.
- Variable copies remain manually positioned after creation; later longer values require layout
  preview again. Circular imposition, reusable multi-operation recipes, personal artwork libraries
  and broader format support remain separate feature work.
- No merge to main, push, deployment, hosted/native testing, device reconnection, motion,
  autofocus, physical Frame, laser operation or hardware qualification is part of this work.
  A completed Frame for the exact reviewed job remains the sole ordinary Start policy gate.

See ADR-349 and ADR-350 for the final behavioural contracts.
