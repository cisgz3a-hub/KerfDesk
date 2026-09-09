# KerfDesk: code-quality audit of the 27 website feature areas

**Completed 2026-09-05. The code has several well-engineered subsystems, but the reviewed features are not consistently implemented to the same standard. This audit found 31 concrete defects: 4 high priority (P1), 26 normal priority (P2), and 1 smaller issue (P3).** Eight feature areas had no new confirmed defect in the inspected paths. That is a scoped assessment, not proof that those features are flawless or optimally implemented.

The main recurring weakness is integration: some edits preserve geometry but lose operation metadata; some asynchronous results outlive their document/controller owner; and some image paths disagree about which pixels are authoritative. Existing tests often cover each helper independently while missing these transitions. The appropriate response is targeted correction of these boundaries, not a general rewrite.

## Exact scope and source

- Website: [kerfdesk.com](https://kerfdesk.com/), recorded build **v0.1.1962 / ccaa3064**. This follows the [website feature inventory and partial Browser test record](../2026-09-05-website-features-and-button-audit.md).
- Reviewed commit: [`ccaa3064d9efe904821307f0603ce842d903b586`](https://github.com/cisgz3a-hub/KerfDesk/tree/ccaa3064d9efe904821307f0603ce842d903b586). Remote `main` matched at the start and at final preservation verification.
- The user's working checkout was older, on `claude/vcarve-stamp-subcell` at `9209fcb33f4807ebfc1f7a55780069b6a7b0e23c`, with inherited edits. We audited an isolated archive of the deployed commit at `C:\Users\Asus\.codex\audits\kerfdesk-features-20260905-ccaa3064`.
- Each feature was traced through its command/dialog, state change, relevant core computation/consumer, and existing tests. Independent lanes reviewed numbered areas; the integrating reviewer read the reports and reproduction fixtures, checked the highest-priority source chains and reconciled duplicates. Features 1–7 received an additional independent adversarial review.
- No application implementation, settings, controller, provider, deployment or hardware changes were made. Added files in the working checkout are this audit report and its evidence. Dependencies and temporary probes live in the isolated snapshot.

## Highest-priority corrections

P1 means the defect should be corrected before relying on the affected workflow's output or coordinate state. It is not a claim that hardware harm occurred, and it does not change the product's Frame-first Start contract.

| ID | Defect and concrete effect | Evidence and detailed fix |
| --- | --- | --- |
| F24-1 | **Move laser here uses the wrong coordinate frame.** With WCO `(40,50)`, canvas machine target `(100,100)` emits an absolute work-coordinate jog, whose machine destination is `(140,150)`. The canvas route also bypasses the existing CNC point-move retract path. | Real store/GRBL-driver wire reproduction, fake port; upstream [GRBL jogging semantics](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Jogging). [Features 22–27](features-22-27.md) |
| F24-2 | **Old Set Origin completion modifies a new controller session.** A disconnect after G92 ACK clears origin; the old completion later restores it. After reconnect, it can overwrite the replacement session's reported WCO. | Two fake-port lifecycle reproductions, including actual close listener and reconnect. [Features 22–27](features-22-27.md) |
| F12-03 | **Image Studio Apply can leave original pixels authoritative for output.** Edited embedded pixels coexist with the old paged asset; later hydration replaces the edit with original pixels, or rejects resized dimensions. | Real edit mutation and hydration with tiny in-memory asset pages. [Features 8–14](features-08-14.md) |
| F14-01 | **Rectangle chamfer loses its Design Studio carve layer.** A rectangle on a custom layer becomes a path with no layer ID and falls back to the first layer, changing applicable cut/depth/tool settings. | Real geometry operation and layer-resolution reproduction. [Features 8–14](features-08-14.md) |

## Feature-by-feature assessment

The detailed reports contain strengths, exact source locations, trigger/impact, surrounding guards, test evidence, a scoped fix and acceptance criteria. “No new finding” means none was established in the inspected paths; the specific unverified portions are stated in each report.

| # | Feature | Code-quality assessment | Confirmed findings |
| --- | --- | --- | --- |
| 1 | Projects, artwork import and output | Strong document/request ownership, save version handling and recovery sequencing | No new finding in inspected entry/save paths; downstream image/output findings are listed below |
| 2 | Selection, editing and object management | Good undo grouping, dependency cloning and stale-selection guards | No separate finding |
| 3 | Drawing and measurement | Good pure gesture logic, geometric constraints and final-commit boundaries | No new finding |
| 4 | Alignment, repetition and nesting | Arrays/nesting have useful planning and identity safeguards; flip/split lose correctness | F04-01 rotated flip; F04-02 Break Apart loses operation bindings |
| 5 | Vector preparation | Weld/booleans preserve effective settings better than Dogbone | F05-01 Dogbone collapses mixed operations |
| 6 | Text and fonts | Good Unicode/font/geometry separation; incomplete ownership and metadata preservation | F06-01 delayed insertion into another project; F06-02 edit resets power scale; F25-1 cross-reference |
| 7 | Operations, layers and run order | Explicit IDs and canonical ordering are strong; unique-operation copying is incomplete | F07-01 Make unique discards effective overrides |
| 8 | Laser cutting and engraving settings | Core validation is stronger than the form's cross-field constraints | F08-01 density step mismatch blocks OK; F08-02 stale grayscale maximum |
| 9 | Material recipes and libraries | Useful linking/provenance; multi-step edit is not lossless | F09-01 omitted details reset; F09-02 air assist cannot turn off |
| 10 | Design Library | Good dialog/document ownership, fresh identities and error behavior | No new finding |
| 11 | Tracing and bitmap preparation | Trace ownership is careful; crop misses the paged representation | F11-01 paged-image crop becomes white and retains old dimensions |
| 12 | Image Studio | Strong session ownership; dirty state and pixel-source consistency need work | F12-01 Undo dirty state; F12-02 eraser color; F12-03 stale paged pixels; F12-04 mixed PNG/luma revisions |
| 13 | Image adjustments and filters | Clear pixel math; composition and keyboard behavior diverge from Apply | F13-01 Enter on Cancel commits; F13-02 opacity ignored in single-layer preview |
| 14 | Design Studio | Good sketch/scene separation; conversion metadata and apply lifecycle are incomplete | F14-01 chamfer layer loss; F14-02 empty reapply leaves output; F14-03 restored pending work marked clean |
| 15 | Box generation and fit testing | Strong worker ownership and matching-preview insertion; coupon validation is weaker | F15-01 blank CNC relief diameter generates unrelieved coupons |
| 16 | Calibration and cut planning | Good generator/output separation; incomplete draft validation | F16-01 blank Material/Interval speed creates unexportable calibration |
| 17 | Registration jigs and board placement | Good capture ownership and undo; grid construction has unbounded total work | F17-01 UI accepts 100 million synchronous jig objects |
| 18 | Camera workflows | Source lifecycle is careful; alignment completion lacks a matching owner | F18-01 canceled alignment modifies replacement project |
| 19 | Rotary, Print and Cut, Labs | Coherent laser mapping, capture trust and experimental-state handling | No new finding; CNC rotary output is intentionally excluded |
| 20 | Machine Setup / CNC Startup Setup | Coherent local draft/save and explicit software-versus-firmware outcomes | No new finding |
| 21 | CNC machining | Substantial geometry/provenance/output invariants; some avoidable duplication | No new finding in inspected compiler/emitter paths |
| 22 | CNC specialist workflows | Relief/probe ownership is strong; surfacing and full-page modal need correction | F22-1 synchronous multiplicative surfacing work; F22-2 Delete leaks through 3D modal |
| 23 | Preview and G-code inspection | Good model/render lifecycle separation; one readiness race | F23-1 traversal-off choice lost during scene loading |
| 24 | Positioning and origin | Concrete controller coordinate and ownership defects | F24-1 wrong coordinate frame; F24-2 stale G92 session completion |
| 25 | Job execution and recovery | Strong exact Frame/claim structure; variable completion side effect can be missed | F25-1 serial/record advancement armed after completion |
| 26 | Air assist, console and macros | Good command validation and accessory uncertainty handling; small copy gap | F26-1 docked clipboard failure has no handling/fallback |
| 27 | Workspace layout, help and PWA | Acceptable state separation/update ownership in inspected paths | No new finding; earlier About/Browser stall remains undiagnosed |

Detailed reports, in the original feature order:

1. [Features 1–7: projects, editing, geometry, text and operations](features-01-07.md)
2. [Features 8–14: cut settings, libraries, images and Design Studio](features-08-14.md)
3. [Features 15–21: generators, calibration, camera, setup and CNC](features-15-21.md)
4. [Features 22–27: specialist CNC, preview, positioning, execution and support](features-22-27.md)

## Complete finding register

| ID | Priority | Finding | Verification |
| --- | --- | --- | --- |
| F04-01 | P2 | Rotated artwork flips about local axes instead of the requested world reflection | Reproduced geometry |
| F04-02 | P2 | Break Apart drops path-operation assignments | Reproduced store/binding result |
| F05-01 | P2 | Dogbone merges distinct operation regions onto the first operation | Reproduced; CNC mode additionally checked |
| F06-01 | P2 | Text can finish inserting after Escape into a replacement document | Reproduced DOM/store with deferred render |
| F06-02 | P2 | Editing text drops object power scale | Reproduced actual upsert boundary |
| F07-01 | P2 | Make unique removes effective artwork overrides | Reproduced store/effective settings; current trace/inspector route checked |
| F08-01 | P2 | Reciprocal density values violate interval step and block native submit | Reproduced production controls in jsdom |
| F08-02 | P2 | Grayscale minimum power is constrained by old maximum power | Reproduced DOM validity |
| F09-01 | P2 | Wizard Next resets details absent from the current step | Reproduced real recipe reader in three modes |
| F09-02 | P2 | Unchecked recipe air assist falls back to true | Reproduced real form/reader boundary |
| F11-01 | P2 | Crop of paged-only image substitutes white and retains incompatible source asset | Reproduced actual crop |
| F12-01 | P2 | Image Undo/Redo after Apply does not mark the changed pixels dirty | Reproduced store/lifecycle and Apply control |
| F12-02 | P2 | Eraser always paints white despite selected background | Reproduced store/pixels |
| F12-03 | P1 | Edited paged image rehydrates original pixels or fails changed dimensions | Reproduced mutation/hydration |
| F12-04 | P2 | Async encoding can combine PNG and luma from different revisions | Reproduced actual encoder with controlled callback |
| F13-01 | P2 | Enter on adjustment Cancel/Reset commits | Reproduced Cancel keyboard case; shared handler covers Reset |
| F13-02 | P2 | Single-layer adjustment preview ignores opacity/visibility/blend | Reproduced opacity case; shared fast path inspected |
| F14-01 | P1 | Chamfering a rectangle drops its carve layer | Reproduced geometry/layer resolution |
| F14-02 | P2 | Deleting final Design Studio output cannot clear previously applied artwork | Reproduced mutation and Apply gating |
| F14-03 | P2 | Restored unapplied drawing has Apply disabled | Reproduced restore/control state |
| F15-01 | P2 | Empty CNC relief diameter produces coupons without relief | Reproduced DOM/generator geometry |
| F16-01 | P2 | Empty speed generates calibration whose G-code emission fails | Reproduced both dialogs, compile and GRBL emission |
| F17-01 | P2 | Jig UI dispatches an unbounded rows × columns construction | UI boundary reproduced; 100-million allocation intercepted; loop inspected |
| F18-01 | P2 | Canceled delayed alignment writes to another project | Reproduced real wizard/store; capture and solve mocked |
| F22-1 | P2 | Surfacing allocates the entire rows × passes output synchronously | Source-confirmed; no huge allocation attempted |
| F22-2 | P2 | Full-page CNC 3D modal lets Delete target underlying artwork | Reproduced actual modal/global shortcut; WebGL mocked |
| F23-1 | P2 | Turning traversal off before scene readiness is forgotten | Reproduced actual Inspector with deferred scene |
| F24-1 | P1 | Canvas machine coordinates are emitted as absolute work coordinates | Real store/driver wire with fake port; upstream semantics |
| F24-2 | P1 | Old Set Origin completion restores/overwrites a new session's origin/WCO | Two fake-port close/reconnect reproductions |
| F25-1 | P2 | A short successful job can miss variable advancement during recovery activation | Real transmission/observer with delayed activation and simulated terminal |
| F26-1 | P3 | Docked console copy silently fails or rejects without fallback | Source-confirmed; comparison with working Super Console handling |

There are **31 distinct mutation/behavior findings**, not 31 independent root causes. F11-01/F12-03 share the paged-image boundary but affect separate crop and Apply paths. F09-01/F09-02 can share one step-aware recipe fix. F25-1 is counted once under execution despite also affecting feature 6. Geometry metadata findings concern different transformations and need their own regression cases even if a shared preservation helper is introduced.

## Verification record

| Evidence | Result | Meaning |
| --- | --- | --- |
| Existing focused suites | **21 files, 144 tests passed**, 33.52 s | Existing checked behavior remains green on the deployed source; [raw output](existing-suites-01-07.log) |
| New probes for features 1–7 | **6 expected-invariant failures** | Each failure exposes its named defect; [fixture](audit-feature01-07.test.tsx), [output](repro-01-07.log). [CNC Dogbone follow-up](repro-dogbone-cnc.log) reconfirms the same finding in CNC mode |
| New probes for features 8–14 | **17 observed-defect tests passed** | Assertions deliberately describe bad current behavior; [fixture](features-08-14-audit-test.tsx), [raw output](features-08-14-test-output.txt) |
| New probes for features 15–21 | **5 observed-defect tests passed** | Four findings; Material and Interval are separate cases; [fixture](features-15-21-repro.test.tsx), [output](features-15-21-repro-output.txt) |
| New probes for features 22–27 | **6 observed-defect tests passed** | Five reproduced findings; origin has two cases; [fixture](audit-feature22-27.test.tsx), [normalized tool-output record](audit-feature22-27-vitest.txt) |
| Preservation check | **25 inherited files unchanged; 4,602 archived files unchanged** | SHA-256 comparison against starting hashes and original archive; [result](preservation-result.json), [checker](verify-preservation.py), [baseline](baseline.json) |

The four new fixtures contain **34 distinct test cases**. Twenty-nine findings have a focused reproduction, with the jig finding explicitly limited to dispatch plus static loop evidence; surfacing workload and console clipboard handling are source-confirmed only. Some tests mock I/O or rendering to control timing. Their exact boundaries are stated in the reports. The probes are evidence files and must not be merged as passing acceptance tests; fixes should replace the bad-behavior assertions with the intended invariants.

The source archive has no Git metadata, so Vite's build-label lookups print three harmless `not a git repository` diagnostics. These did not prevent test collection or execution. No full release suite or packaged build was run, and the earlier incomplete Browser button sweep is still incomplete. This code audit does not establish full accessibility, offline/update continuity, all import-format compatibility, production-size performance, reference-CAM agreement or physical machine qualification.

## Recommended implementation order

1. Correct the four P1 coordinate/source/operation-integrity defects, with regression tests at the actual consumer boundary. Keep Frame as the sole ordinary Start gate and preserve warnings in Job Review.
2. Preserve metadata through Break Apart, Dogbone, text edits and Make unique. Share a narrowly defined metadata-preservation contract where appropriate; do not apply every operation to all newly merged geometry.
3. Finish paged-image crop/Apply integration and freeze one pixel revision during encoding. Then repair image dirty state, filter preview and native keyboard behavior.
4. Introduce step-specific material patches and complete numeric drafts; cover native click/Enter submission. Fix camera/text async ownership and run-specific variable completion alongside their existing owner patterns.
5. Move large jig/surfacing preparation into bounded, cancellable work while retaining exact requested geometry. Fix modal isolation, Inspector readiness synchronization and clipboard feedback.

Maintainability improvements should follow demonstrated needs: reuse prepared job facts in the run-order panel instead of recompiling during render; consolidate duplicated CNC group-field assembly; use unit-correct Inspector playback names; and consider the common accessible Dialog for informational help. These are separate from the 31 defect findings. No source repair, commit, merge or deployment is included in this audit.
