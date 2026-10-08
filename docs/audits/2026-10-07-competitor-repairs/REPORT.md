# Competitor-derived repairs

Date: 7 October 2026. Branch: `codex/fix-competitor-findings-20261007`. Implementation checkout: `D:\LaserForge\competitor-fixes-20261007`.

All ten findings from the reliability, UX and safety comparison are implemented and qualified locally. The source qualification checkpoint is `da10ce94de5e81f180ee09452729359cb8139f3b`, based on main `76b5ff53e3be7df6c160a8b26820e61188595f08`. The original audit and unrelated primary-checkout work are preserved. The report and ledger are saved in a subsequent documentation commit; the checks and renderer identities below refer to the source checkpoint.

| Finding | Resulting behaviour | Local checkpoint |
| --- | --- | --- |
| I1 Root SVG aspect and placement | Default aspect alignment follows SVG semantics. KerfDesk exports explicit, finite artwork-origin metadata for exact placement round trips without changing rendered pixels. | `32e2fbbdc`, `7ac9707a3` |
| I2 Nested SVG clipping | Invisible geometry outside hidden nested viewports is clipped, including viewport-owned clip coordinates. | `25d3ff790` |
| F1 Close open Fill contours | The repair changes canonical curves and compatibility geometry together, adds actual Fill output, and remains one Undo step. | `961b18fe3` |
| I3 SVG percentages | Supported primitive, use and clip coordinates, dimensions and radii resolve against their active viewport and axis rather than numeric prefixes. | `83fa9f752` |
| F2 Effective Fill omissions | Warnings use effective object settings and executable closure. Show omitted artwork selects only matching reviewed sources and fits the artwork view. | `abe37f450` |
| C1 Mixed CNC omissions | A valid closed contour no longer hides an omitted open contour. Counts and exact sources survive prepared and retained output. Review remains advisory. | `e7132128a` |
| R1 Recovery arc distance | Recovery distance estimates measure supported arc sweeps rather than their chords and report unknown distance for unsupported or ambiguous motion. Archived executable text remains exact. | `386c0762f` |
| D1 Incident retention | A separate bounded history keeps event-time alarms, errors and disconnects across routine traffic and reconnect. Reports redact captured context before escaping. Explicit Clear history removes retained incidents. | `f12f7ac4a` |
| K1 Shared topology | Holes, islands and kerf topology are resolved within an operation/run before differing process settings split output. Crossing ownership uses actual positive canvas contributors. | `c6ac3e7f6` |
| K2 Segmented ordering | Parent-contour packets retain inside-first ordering across tabs, perforation, main passes and low-power bridge passes. Historical jobs retain their ordering contract. | `9525e4bf8` acceptance; shared source in `c6ac3e7f6` |

## Qualification

All results below use source `da10ce94de5e81f180ee09452729359cb8139f3b`. The 92 changed production-file hashes match the frozen snapshot after qualification.

| Check | Verified result |
| --- | --- |
| Full unit suite | 28,313 passed, 0 failed, 29 skipped; all 3,598 files covered; no unhandled run errors. |
| Source and E2E types | Both checks exit 0. |
| Full lint | Exit 0; zero errors and warnings. |
| Full formatting | Corrected workspace-root ignore configuration exits 0. |
| Repository checks | File-size, soft-size, ADR-number and index-export checks exit 0. |
| Browser workflows | 22 unique cases qualified: 20 initial passes and two unchanged cases passed on isolated rerun within their original timing budgets. |
| Browser-Free renderer | Build exit 0; embedded SHA `da10ce94`, version `0.1.3042`, capability `browser-free`; only Line Art preset data. |
| Desktop renderer | Build exit 0; same SHA/version, capability `desktop`; all eight presets retained. |
| Visual inspection | Seven fresh screenshots directly inspected from passing final-source workflows. |

Both builds embed emitter revision `operation-topology-fill-ownership-contour-packets-20261007-v17`. [FINAL-EVIDENCE.json](FINAL-EVIDENCE.json) records counts, commands, result hashes, production hashes and build identities. [SKIPPED-TESTS.json](SKIPPED-TESTS.json) names the 29 configured skips, including Windows link exclusions, opt-in audits/benchmarks and tests requiring local artwork. [STATUS.md](STATUS.md) retains individual repair checkpoints and focused evidence. The 291 topology-focused cases and 332 cache-connected cases overlap the full suite and are not added to its total.

The browser workflows exercise actual SVG import, worker preparation, canvas/export round trips, Tools closure, Undo/Redo, save/reopen, reviewed-source reveal, retained incidents and saved G-code. Independent emitted-motion interpreters check Fill membership/ownership, tab lengths, power/feed settings, pass ordering and final-pass overcut. Frame and Start workflows use a simulated controller. Screenshots confirm reimport, reopened Fill, laser omission review, CNC source selection, mixed-setting Fill/Line workspaces and retained incidents.

The first final browser attempt had two initial-navigation timeouts: 121.810 seconds against a 120-second incident-test budget, and 65.108 seconds against a 60-second Frame-test budget. Teardown began before either intended control was reached. Each trace records 3,640 short HTTP 200 resources; neither shows a single blocking HTTP request of that duration. Both unchanged cases subsequently passed within their original budgets. The underlying startup delay remains unqualified. The original traces and an empty retry-filter attempt are preserved.

An initial full formatting attempt resolved ignore paths relative to a scratch file inside the evidence directory. Its 567 reports comprised 564 evidence artifacts and three already-excluded generated files. The corrected check used the canonical exclusions from a workspace-root scratch file and passed without production edits. The failed output remains preserved.

Raw evidence is retained under `output/competitor-repairs`, including the final unit JSON/JSONL, qualified static checks, final browser events and retry events, screenshots, emitted-output oracles, build logs and compiled bundles. Earlier checkpoints, including `9525e4bf8`, interrupted unit attempts and corrected fixture failures remain historical records. Final unit totals come from the complete stage-3 run; final browser totals come from the final-source run and its two-case rerun.

The broad run exposed a Fill-cache regression: filtering uniform Fill membership created a fresh cache-input array on every estimate. The correction retains the original array for an all-Fill selection and uses an eight-entry, source-keyed WeakMap for proper subsets. Line/Image overrides remain outside the Fill material. All 19 cache cases pass, including the unchanged original miss assertions, membership/setting/geometry changes and exact emission. A returned-mock cleanup hook and a lint annotation were corrected in the new fixtures; the original failures remain recorded. A failed-macro assertion now requires the retained transport-failure incident and forbids outbound or macro-success provenance.

## Material limits

The crossing-Fill working default uses the frontmost positive canvas contributor. Nested positive islands retain their settings; negative holes cannot own restored crossing material. Machine-output artwork priority is separate from canvas stacking. Uniform process settings retain the dense-trace fast path.

SVG clipping follows the documented viewport intersection rule. A native Chrome deviation for a viewport's own clip/overflow interaction is recorded in ADR-574. Unsupported effects retain their existing disclosure. Older KerfDesk SVG exports without versioned artwork-origin metadata reimport using standard SVG viewport placement, which may change their original scene position. CSS geometry and percentage-sized images remain outside the supported percentage contract.

Incident history is bounded to the current app window and does not persist across an application restart. Support reports contain bounded build/device/controller/job context rather than artwork or executable content. Recovery distance estimates qualify supported arc geometry, with unknown results for unsupported or ambiguous motion.

This work provides local source, test, browser and renderer-build evidence. No branch has been pushed, merged or deployed. Hosted CI, published builds, licensing/provider state, installers, physical machines and material results remain unqualified. Frame reuse and each Start's fresh executable review remain governed by ADR-565; the repairs introduce no additional policy or entitlement gate.
