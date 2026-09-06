# Tracing integration onto pinned main

Base: `00abb56e151332a85d9f9673ed6a5e0fae3faaef`.
Scope: TR-013, TR-014, TR-012, TR-017, TR-018, TR-019, TR-016 and TR-020.
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
TR-006 describes closed outlines but omits the demonstrated 64/112 dark split limit.
Those queued control findings are dispositions, not additional fixes.

The historical imageMaskId-only probe does not establish a current source-byte flaw:
Trace reads the full original raster. Rebinding a mask before Submit leaves those
bytes unchanged; applying/removing a mask after Submit replaces the exact object and
retires the commit owner. A baked crop changes source bytes. Ordinary background
editing is suppressed by the existing modal shell; the probe is separate from
Trace Transparency and boundary-crop mask-intent findings.

A retained schedule observation needs separate review: submitting while a detection
change still has a pending preview debounce can be superseded by that preview.
The observed dialog became ready without committing output. The accepted terminal
witness is qualified with the current request dispatched and its native reply held;
the pending-debounce schedule is not claimed fixed or classified against an untouched
baseline by this integration.

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

The manager owns publication and exact-head hosted `Chrome UX smoke` and
`Lint, typecheck, license, test, build` gates. Local commits do not represent a
push, merge, deployment, packaged-runtime qualification or hardware run.
