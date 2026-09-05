# PR #101–300 audit and remediation

The audit reviewed 200 historical PRs in **cisgz3a-hub/KerfDesk**, against pinned audit baseline `aa44ac7f37a95d23af36d480894b0acf6b604647`. It confirmed ten surviving code defects, including one found during independent remediation review. PRs #113, #235, #246 and #289 never merged; the remaining 196 did.

The first-100 audit and the #301–500 audit have separate owners. This report covers #101–300. The original dirty checkout was preserved; implementation used isolated worktrees.

## Findings

| Finding | Historical attribution | Reproduced weakness | Remediation |
| --- | --- | --- | --- |
| N200-103-DXF · P2 | #103 | A 235-byte nested INSERT expands to 150,000 paths and throws an argument-list RangeError. | [#738](https://github.com/cisgz3a-hub/KerfDesk/pull/738): append incrementally; preserve all transforms, ordering and geometry. Existing worker cancellation remains available. |
| N200-129-ORIGIN · P2 | #129; later #291 path inspected | A late Set Origin completion after reset/disconnect can overwrite a newer controller session. | [#732](https://github.com/cisgz3a-hub/KerfDesk/pull/732), owned by the concurrent feature audit: recheck session, write and operation ownership through ACK/WCO completion and UI continuation. Independently challenged here. |
| N200-131-HEIGHT · P2 | #131 | Positive material height moves the reconstructed plane away from an overhead camera, doubling projection error in a simple case. | [#745](https://github.com/cisgz3a-hub/KerfDesk/pull/745): correct the scene-coordinate plane translation; verify physical projection and overlay/trace consumers. |
| N200-131-SOURCE · P2 | #131 | URL redaction makes different RTSP channels appear to be the same calibrated source. | [#745](https://github.com/cisgz3a-hub/KerfDesk/pull/745): preserve app-keyed resource identity separately from the redacted URL; distinguish ambiguous legacy network bindings and discard superseded discovery results. |
| N200-165-STORAGE · P2 | #165 | A denied localStorage property getter crashes UI-store initialization before the fallback can run. Browser acceptance also reproduced the same failure in three adjacent startup hooks. | [#734](https://github.com/cisgz3a-hub/KerfDesk/pull/734): guarded storage access for preferences and library persistence; edits remain usable in memory. |
| N200-OP01 · P1 | #191, #193, #215 | Automatic pen-fairing replacement discards migrated path operation IDs; 17% power becomes 30%. | Preserve explicit operation bindings through replacement and project migration. |
| N200-OP02 · P2 | #193 | Reassigning an object to operation A is incorrectly a no-op when its paths still bind to B. | Compare path bindings and overrides, then record the real reassignment in history. |
| N200-OP03 · P1 | #193 | Make unique/Add operation clears effective overrides. Merely retaining a global override couples subsequent edits across operations. | Give overrides explicit operation ownership while preserving existing CNC compound groups and old project behavior. |
| N200-OP05 · P1 | #193 | Unknown legacy override fields can replace operation identity and drop laser output; v1/v2 migration can turn a one-pass CNC operation into six passes. | Project only recognized artwork settings into effective operations and migration output. Keep unknown legacy metadata inert. |
| N234-1 · P2 | #234; #268 follow-up inspected | Inner/outer contour selection discards crossing, touching or duplicate outlines as if they were nested rings. | [#739](https://github.com/cisgz3a-hub/KerfDesk/pull/739): strict whole-contour containment with indexed boundary queries and scale-aware contact precision. |

P1 denotes a confirmed output-setting change; P2 denotes a confirmed correctness/availability issue. These are code-review priorities, not a replacement for the machine policy in PROJECT.md.

The four operation findings are repaired in the code accompanying this report. The other repairs are linked above; the Set Origin overlap is owned by the concurrent feature audit and was independently verified here.

The operation changes also repair an adjacent retained-Inspector issue introduced in #699: after canvas deselection, the held artwork operation could display and edit base settings while output still used an artwork override. That repair and the three startup storage hooks are adjacent findings, outside the count of ten attributed to #101–300.

## Method and evidence

- Downloaded all 200 complete historical patches, recorded changed paths and SHA-256 hashes, and reconciled every PR to current feature code. [Coverage](coverage.md) records the exact scope and conclusion for each PR; [manifest](pr-manifest.jsonl) preserves machine-readable provenance.
- Reviewed three bounded ranges with one integration owner. Grouped feature reviews were combined with actual implementation probes, negative regressions and independent challenges. The #101–166 lane recorded 13 positive checks; #167–233 ran 252 tests in 30 files; #234–300 ran 214 tests in 25 files.
- DXF: both text and Blob import reproduce the original 150,000-path failure before the fix. The corrected import retains all paths. Focused import/worker/cancellation verification: 98 tests in 16 files.
- Controller origin: 20 independent transaction, real-store lifecycle and OriginRow tests passed against PR #732 head c7c9c216. No hardware was used.
- Startup storage: six new regression cases failed across the initial store and subsequent app-hook fixes. All 49 focused tests in nine files passed. Headless Chrome rendered the real workspace with storage enabled and denied: HTTP 200, both canvases, rendered controls and no page/console errors.
- Contours: 56 tests in eight files passed, including actual compile/emitter output. An independent 1,080-case transformed-contact sweep and matching real-gap sweep passed. The 16,000-point pair probe took approximately 55 ms locally after boundary indexing; this is a measured probe, not a universal timing guarantee.
- Camera: 381 tests in 73 files, production build and 12 independent identity/lifecycle challenge groups passed. The synthetic physical-projection sweep passed all 54 cases. Camera acceptance used synthetic frames/projections and a fake bridge; it did not qualify a browser-connected camera or optical accuracy. Existing network bindings need fresh calibration; USB behavior is unchanged.
- Operations: after reconciliation with main, 128 tests in 15 focused files passed. An earlier 357-test persistence/ownership run passed after stale schema fixtures were corrected. Independent review passed 13 grouped checks: 25 legacy field/version cases, 32 override-precedence combinations, six real action allocation-collision scenarios, and exact retained CNC pocket output. These probes use actual action factories, serialization and compilers; separate DOM tests check Inspector values against output.
- Independent report review verified all 200 patch hashes and changed-path sets, all ten finding IDs, and all 258 unique evidence paths at the pinned baseline (553 link occurrences).

Local checks use TypeScript, touched-file ESLint/Prettier and applicable repository contract checks. Each remediation PR must pass its current required hosted release and Chrome smoke checks before normal merge. The linked GitHub PRs are the authority for final merge SHA and check state.

## Compatibility

New saves use project schema v5 to retain operation-specific artwork settings. Existing v1–v4 projects remain readable. Older app versions that support only schema v4 need an update to open a v5 save. This extension does not change relief geometry representation.

Saved network camera setups need fresh calibration because their previous redacted identifiers do not establish which resource was calibrated. USB bindings remain supported. Preferences and library changes can be used in memory when browser storage is unavailable; the existing warning explains that the affected settings could not be persisted.

## Scope limits

This is a historical-patch and current-feature source audit with focused runtime/tests, not exhaustive path coverage or a guarantee of no remaining defects. Hardware, optical calibration, air cuts and material cuts were not performed. No manual deployment was performed. Frame-first Start policy remains unchanged; Job Review policy findings stay advisory.

The camera correction follows the actual scene X-right/Y-down basis used by both rendering consumers and independent world-to-camera projection. The coordinate convention is described by [OpenCV pose documentation](https://docs.opencv.org/4.12.0/d5/d1f/calib3d_solvePnP.html). Resource query identity follows the distinction in [RFC 3986 section 3.4](https://www.rfc-editor.org/rfc/rfc3986#section-3.4), while persisted URLs continue to redact credentials, query and fragment.
