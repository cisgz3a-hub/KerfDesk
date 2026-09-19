# CNC audit repair ledger

Baseline: `197a0956c84ceeedae025af5e260878b0b7c1e5f`, reconciled with `origin/main` on
12 September 2026. The original evidence is preserved at
`C:/Users/Asus/.codex/audits/cnc-system-20260912`. New observations and logs belong in
`C:/Users/Asus/.codex/audits/cnc-repair-20260912`.

Integration includes current main `25d9bef9a5defed24259acb8b1d3af69840ff983`
(canvas-performance PR #781), which merged while the repair checks were running.
The CNC repair's source algorithms remain unchanged by that clean integration;
combined persistence, worker lifecycle, browser and release checks cover its interactions.

This ledger tracks implementation and software verification. It does not establish
controller, air-cut, material-cut, or packaged-runtime qualification. The separate
canvas-performance work and PR #781 are outside this repair.

| ID | Required result | Status | Concrete regression evidence |
| --- | --- | --- | --- |
| S1 | Untouched numeric fields preserve values, clean state, and history | Repaired | `use-debounced-commit.test.tsx`; native Chrome checks all eight audit fields with unchanged values, dirty state and undo count |
| S5 | Calculator applies material identity and feed recipe atomically; ordinary Save/reload succeeds | Repaired | `FeedsCalculatorRow.test.tsx`, `settings-persistence.test.ts`; native Apply, ordinary Save, actual page reload and toolbar Open preserve material/feed provenance |
| S2 | New cutter without flute metadata uses the same declared assumption through both selection paths | Repaired | `settings-transitions.test.tsx`; native Tool Plan and default-tool changes use the declared two-flute assumption, with the prior four-flute cutter as control |
| O2 | Shallow and equal-one-peck drilling emits the requested plunge | Repaired; focused software verified | `drilling.test.ts`; exact emitted peck depths, preview depth tolerance, vertical feed-time lower bounds and final-depth retract timing for shallow/equal/multi-peck controls; all three also run in native Chrome. Vertical centre pecks in interpolated registration bores now receive the same XYZ timing treatment. Evidence: `motion-focused.json` (320/320 across 42 files) and `owner-registration-zero-ramp-fixed.json` (84/84; overlapping suites). |
| O1 | Tabbed final passes retain requested fresh-material ramp and tab geometry | Repaired; focused software verified | `tabbed-entry.test.ts`, `tabbed-ramp-entry.test.ts`; emitted fresh-depth entry at each level is lateral at the requested angle, the complete final contour retains four bridges and intentional vertical tab walls, and seam-on-tab/short repeated loops are covered. An explicit zero ramp preserves the selected lead and matches absent-ramp motion. Native 20 mm square ramps below the prior -4 mm floor to -6 mm. Evidence: `motion-focused.json`, `motion-final-entry.json`, `owner-registration-zero-ramp-fixed.json`. |
| S6 | Contour pairing uses boundary geometry and preserves genuine wide regions | Repaired; focused software verified | `contour-selection.test.ts`, `contour-boundary-proximity.test.ts`; both directed boundaries require complete source-segment coverage by target-segment distance capsules. Square/diamond, concave notch, and all-vertices-near/mid-edge-wide counterexamples retain both genuine contours; uniform bands, translations, rotations and different segmentation remain controls. Evidence: `motion-adversarial.json` (27/27) and `motion-focused.json` (overlapping suites). |
| O3 | Registration participates in each tile's clearing/profile and tool order | Repaired | `tile-registration-plan.test.ts`; all four indexed files place registration and other clearing before profiles, including emitted tool identities; no cross-file ordering claim |
| O4 | External IJ and R arcs obey stock GRBL feasibility checks | Repaired | `grbl-arc-acceptance.test.ts`; both audit counterexamples, IJ threshold controls, signed R controls, inches/incremental and valid native-style helix cases |
| R1 | Capacity, cancellation, infrastructure and compilation errors retain request ownership | Repaired; independent lifecycle review completed | `output-preparation-capacity.test.ts`, `job-review-cancellation.test.ts`, `start-preparation-owner.test.ts`, `JobReviewDialog.test.tsx`; healthy saturation and explicit retry, request-local clone failure, retired-worker events, queued identity protection, and real Frame cancellation preserving queued Save. Cancel during confirm/rebuild cannot approve or close a newer review. Exact-input drift releases only its owner; advisory settings and UI-only changes preserve work. Retry preparation requests rebuilding and leaves confirmation separate. Existing Frame policy cases pass unchanged. Evidence: `review-cancellation-before.json` (3 failing controls), `worker-owner-first-fix.json` (36/36), `owner-registration-zero-ramp-fixed.json` (84/84), `owner-retry-final.json` (71/71; overlapping suites). Full TypeScript and owned-file lint checks passed. |
| O5 | Registration owns cutter, diameter, depth and depth step | Repaired | `tile-registration-plan.test.ts`, `registration-geometry.test.ts`, `tile-registration-persistence.test.ts`, `DeviceSetupRegistrationFields.test.tsx`; independently checked bore sweep/depth ladder, explicit tool identity and native Save/reopen |
| S3 | V-carve clearing and inlay expose their active Stepover setting | Repaired | `settings-authoring.test.tsx`; direct control edits change actual clearing output and persist; native V-carve/inlay inspector checks |
| S4 | Profile leads have controls, including persisted explicit opt-out | Repaired | `settings-authoring.test.tsx`; arc/line/none authoring and persisted opt-out, default/off emitted-motion distinction and zero-ramp control; native edit/reopen |
| V1 | V-bit finishing accounts for actual clearing-tool removal | Repaired; independently reviewed | `vcarve-rest-finishing.test.ts` and `cleared-capsule-interval.test.ts`: actual emitted clearing capsules justify only constant-depth floor trimming; full variable-Z walls remain and every resulting chord is source-contained. Square V route 3414.593 → 1450.475 mm; V passes 1 → 32, clearing 218.4 mm unchanged. Two-tool estimated duration 250.346 → 166.427 s, excluding manual tool-change time. Five independent combined-removal cases / 2829 sampled points observed zero lost depth; finite samples do not prove whole-region coverage. Unproven stock retains the original finish. Evidence: `vcarve/repair-summary.json`, `floor-only-removal.log`, `rest-final.log`. |
| V2 | Source-boundary accuracy and corner retention are independently measured | Repaired; independently reviewed | `vcarve-source-accuracy.test.ts`: 20 octagon Detail/rotation variants and 480 inward corner witnesses use independently parsed emitted motion and original artwork. Maximum uncut bisector extent 0.000095902 mm, versus about 0.048 mm at coarse Detail before repair. Compile sidecars separately measure bounded source vertices/midpoints, disclose omitted witnesses and unavailable sweep measurements, and make no full-region accuracy claim. Detail tooltip retains sampling/pitch semantics. Evidence: `vcarve/octagon-detail-rotation.json`, `source-check.log`, `floor-only-removal.log`. |
| V3 | Floor regression criteria describe the current engine's cutter sweep | Repaired; independently reviewed | `vcarve-floor-depth.test.ts` now allows 0.10 mm from current 0.1 mm pitch, cone slope, emitted-compaction and simulator allowances instead of the retired 0.79 mm limit. `vcarve-source-accuracy.test.ts` independently checks 18 angle/tip/pitch floor combinations with analytic scallop bounds and no simulator helper. Pointed floors retain real scallops. The independent audit probe still passes 720 cone-law combinations and 29 shapes / 78489 continuous source-boundary checks; sets overlap existing suites. Evidence: `vcarve/floor-clearance-artifact.log`, `independent-final.log`, `repair-summary.json`. |

Registration persistence uses project schema v6. The identity migration preserves
v5 document contents and absent registration plans; older readers encounter their
existing newer-version check instead of silently dropping the cutting plan. The
five-file migration/persistence suite passed 82 tests (`schema-v6-tests.json`).

Native Chrome 153.0.8010.37 passed all eight editable cut types and the 120-region
V-carve fixture. S1-S6, O1, O2 and O5 UI checks passed, including real toolbar Save,
page reload and Open at schema v6. The existing browser suites passed 4/4. Browser
pickers and controller connections are mocked only at their external boundaries;
no hardware is operated. Per-case source hashes and corrected harness attempts are
retained in `browser/verification-summary.json` and its linked records.

Independent review covered all repair lanes. It found and resolved cancellation
during awaited Job Review rebuilding, stale native input validation after Undo,
zero-ramp lead precedence, registration centre-plunge timing and the old-reader
registration ownership loss. The final R1/v6 review records the reviewed file
hashes in `r1-v6-independent-review-manifest.json`.

Final integration review also found aggregate registration arrays could exceed
JavaScript's representable length despite valid individual depth/ring counts.
The repair checks each peck-point array and each tile's complete interpolated-pass
array before generation, using the actual seam-hole count and the existing Array
limit. Ten arithmetic/grid regressions and the seven-file, 50-test registration
suite pass without allocating enormous paths.

Two connected-script output pins changed with corner retention. Replacing only
the new 10-degree threshold with the former 50-degree threshold reproduces both
old programs byte for byte. Updated pins retain exact serial/parallel output and
index-reuse assertions. Independent checks of 23,474 distinct current V chords
observed no cutter sweep outside their normalised source boundaries. The largest
sampled local removed-depth decrease is 0.008408 mm, below the existing radial
compaction allowance's 0.017321 mm depth equivalent for these 60-degree cutters.
This finite comparison is separate from the V1 clearing-removal measurements above.

Integration requires the full project release gate, independent final diff review,
exact-head PR checks, authorised merge and post-merge main checks. Their actual
revision-correlated results belong in the associated PR checks and the repair
evidence directory's release logs/manifest. Overlapping test suites must not be
summed as unique coverage. Deployment and physical qualification are separate.
