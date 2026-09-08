# Tracing integration onto pinned main

Base: `00abb56e151332a85d9f9673ed6a5e0fae3faaef`.
Scope: TR-013, TR-014, TR-012, TR-017, TR-018, TR-019, TR-016, TR-020 and TR-015.
The earlier audit branch is evidence; its divergent history is not part of this integration.

## Behavior and semantic integration

| Finding | Pinned-main disposition | Integration |
| --- | --- | --- |
| TR-013 | Exact document/source/dialog ownership already existed; component unmount could still allow a late commit. | Compose mounted lifetime with current capture/claim ownership. Keep transform changes before Submit eligible and exact source identity after Submit. |
| TR-014 | The embedded Image Studio revision already clears the paged asset reference. | Add the adapted paged-source and history regression; retain current product implementation. |
| TR-012 | Camera capture opened a transient seed that ordinary scene ownership could not commit; abandoned captures could open a new dialog. | Explicit camera origin, capture lifetime, private calculation snapshot and one atomic source/output/history mutation. |
| TR-017 | Shared kerf normalization already fixed the original overlap witness. Raw zero-signed-area self-intersections were filtered too early. | Let the existing even-odd topology engine resolve closed input before filtering finished contours by area. |
| TR-018 | Text is already normalized per object before layer pooling. Same-colour operation identities could share a fill cache entry. | Add operation identity and binding identity to the cache key. |
| TR-019 | Current compiled raster rendering already respects effective settings, masks, power and transforms. Obsolete settings could retain pending work; object power scale was missing from its key. | Prune pending builds against all active effective keys and source content; retain concurrent operations; include power scale. |
| TR-016 | Early terminal empty/error commits could leave the preview tracing indefinitely. Prepared ready results were already reused. | Settle the owned preview from the commit result/error without another trace request, preserving retry notices. |
| TR-020 | Expensive inline work blocked the UI, and obsolete native worker jobs delayed the latest preview until the watchdog. | Pure resumable computation with a synchronous core runner, cooperative UI execution, exact worker ownership and bounded recovery. |
| TR-015 | Removing Clear Boundary or disabling a mouse-focused Trace button left focus on the document body, where Escape could not reach the dialog. Cancel was disabled during tracing. | Recover focus within the active dialog when its focused control disappears or becomes unavailable; keep Cancel enabled and preserve deliberate focus moves and stacked-dialog ownership. |

The newer detection policy, separate despeckle control, Edge outline/perimeter help,
retry notices, raster machine-row display and V-carve timeout remain intact.
Frame remains the sole ordinary Start gate. These changes introduce no policy refusal.

## Evidence and boundaries

Focused regressions and current-main browser witnesses are retained by the audit manager.
The browser work uses actual production components, stores, generated camera frames,
native workers and local Vite, with independent geometry and emitted-motion oracles.
It does not qualify the full App, a production bundle in a browser, hosted CI,
deployment, a packaged runtime, reference CAM output or hardware.

Full ordered geometry is compared with equivalent current-main effective options
for contour, Edge, Centerline, alpha, crop, Enhance and scale routes. Responsiveness
qualification is bounded to the accepted expensive fixtures within the existing
160000-pixel fallback boundary. Large diagnostic routes and result serialization
are not covered by a general sub-100-ms promise.

TR-001's explicit numeric-history and separated despeckle witnesses pass.
TR-002 still carries hidden Smoothness/Optimize into Edge geometry.
TR-006's tooltip describes closed outlines but omits the demonstrated 64/112 dark split
limit; the full-dialog footer still promises single lines along full-colour edges.
Those queued control findings are dispositions, not additional fixes.

The historical imageMaskId-only probe does not establish a current source-byte flaw:
Trace reads the full original raster. Rebinding a mask before Submit leaves those
bytes unchanged; applying/removing a mask after Submit replaces the exact object and
retires the commit owner. A baked crop changes source bytes. Ordinary background
editing is suppressed by the existing modal shell; the probe is separate from
Trace Transparency and boundary-crop mask-intent findings.

Submitting while a detection change still had a pending preview debounce could lose
the explicit Trace action. Eight paired observations on pinned main and the first
integration established that the lost output predated the port, while the port changed
the generic supersession error into silent cancellation. Submit now claims its current
preview token synchronously. The pending decode or debounce for that token cannot
replace the submitted request; a genuinely newer request still wins.

Four fixed native pairs and six additional controls cover nonempty/empty output,
ordinary and transient-camera vector/raster commits, terminal error recovery,
prepared-result reuse, newer settings and document replacement. Reply delivery is
held across the real 300 ms debounce; the error is deliberate one-response injection.
The earlier document-replacement control used public stores because Cancel was disabled
while busy. The subsequent TR-015 correction has its own focus and cancellation evidence.

TR-015 adds 12 component regressions and passes 178 related cases across 18 files,
giving 190 distinct passing cases across 20 files. Eight valid native baseline
failures establish lost focus or unavailable Cancel. The fixed native run passes
20 Trace controls and three shared-modal controls, covering crop and Enhance,
ordinary and transient-camera vector/raster output, keyboard wrapping, Escape,
Cancel, prepared-result reuse, stacked dialogs and opener restoration.
Twelve cancellation controls hold a successful native worker reply until after
the dialog closes, then verify that project, scene, history, selection and dirty
state remain unchanged after release. Four prepared positive controls add exactly
one undo step without another trace request. These are isolated production-component
fixtures with controlled reply delivery, not full-App performance, device-camera,
packaged-runtime or hardware qualification. Failed and incomplete harness attempts
remain recorded separately; they are not counted as passing controls.

The manager's output review covers twelve fill records with eleven distinct labels
and four text cases using three fonts. All 24 compiler cases agree with their
qualified preview/emission bounds; four unchanged Scanline/Island controls retain
0.02335–0.03030 mm of cumulative excursion beyond unrounded source regions, with
less than 0.0005 mm of emission deviation from the rounded-region preview. They are
not zero-excursion proofs. TR-007's narrow-notch crossing witnesses remain queued.

## Reproduction and publication

Run the normal repository checks in a correctly installed checkout:

```sh
pnpm release:check
```

The audit used an existing dependency junction, independently checked against all
45 declared package ranges. The installed pnpm default attempted reconciliation
and aborted without a TTY. The subsequent local gate uses process-scoped
`pnpm_config_verify_deps_before_run=warn`, verified in the installed pnpm source,
to report workspace-layout drift without altering the shared runtime. This is
separate from a fresh lockfile installation and hosted exact-head checks.

That normal gate reached Vitest: 12442 tests passed, two tests exposed an incomplete
worker-module mock, and 32 suites could not load SVG assets through the external
dependency junction. The mock now keeps the real supersession helper. All 156 tests
in the 33 affected files pass with the resolved dependency directory allowed in a
local test configuration. The original failed gate and the subsequent checks remain
separate evidence records; the original command is not reported as a green run.

For the original integration, independent reconciliation yields 12583 passing and
22 skipped test identities
across 1950 passing and 14 skipped files after replacing the affected file results.
The original integration's 703 distinct focused/recovered cases and the debounce
follow-up's 149 passing cases in 12 files are overlapping evidence groups, not
additional totals. Final typecheck, scoped lint/format and the remaining local
release steps passed; the follow-up did not repeat the full release command.

PR #776 carries this integration. The maintainer authorised publication and merge
after the TR-015 handoff. Exact-head hosted `Chrome UX smoke` and
`Lint, typecheck, license, test, build` remain required before merge; post-merge
CI and automatic Pages publication are verified separately. Local commits do not
represent hosted checks, deployment, packaged-runtime qualification or hardware runs.
