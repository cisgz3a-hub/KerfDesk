# PR audit progress

Updated: 2026-10-11T12:39:38.828Z. Repository: cisgz3a-hub/KerfDesk.

The loop is active. 1156 PRs are inventoried: 61 full-diff reviews, 50 partial reviews and 1045 unstarted. Partial reviews retain their explicit gaps in coverage.json. This is not a whole-history completion claim.

19 original findings, plus their recorded review follow-ups, are tracked in 15 coherent repair groups. 15 repair PRs are open or recorded; 13 have successful required CI recorded at their published heads.

| Finding | Historical origin | Defect / repair | Current state | Repair PR |
| --- | --- | --- | --- | --- |
| FND-001 | [#10](https://github.com/cisgz3a-hub/KerfDesk/pull/10) | SVG import drops visible children overriding inherited fill or stroke opacity | merged-ci-verified | [#1139](https://github.com/cisgz3a-hub/KerfDesk/pull/1139) |
| BITMAP-01 | [#10](https://github.com/cisgz3a-hub/KerfDesk/pull/10) | Retain boundary outlines after pixel-coordinate rounding | merged-ci-verified | [#1140](https://github.com/cisgz3a-hub/KerfDesk/pull/1140) |
| EUM-01 | [#14](https://github.com/cisgz3a-hub/KerfDesk/pull/14) | Preserve valid imported thicknesses when opening the material editor | merged-ci-verified | [#1141](https://github.com/cisgz3a-hub/KerfDesk/pull/1141) |
| EUM-02 | [#14](https://github.com/cisgz3a-hub/KerfDesk/pull/14) | Keep the canonical material identity during an unchanged preset edit | merged-ci-verified | [#1141](https://github.com/cisgz3a-hub/KerfDesk/pull/1141) |
| EUM-03 | [#14](https://github.com/cisgz3a-hub/KerfDesk/pull/14) | Update operation metadata when changing a preset's process mode | merged-ci-verified | [#1141](https://github.com/cisgz3a-hub/KerfDesk/pull/1141) |
| CCA-001 | [#33](https://github.com/cisgz3a-hub/KerfDesk/pull/33) | Append camera preview cache busting outside the proxied camera URL | merged-ci-verified | [#1142](https://github.com/cisgz3a-hub/KerfDesk/pull/1142) |
| CCA-002 | [#32](https://github.com/cisgz3a-hub/KerfDesk/pull/32) | Use the grabbed selected node as the drag reference | merged-ci-verified | [#1143](https://github.com/cisgz3a-hub/KerfDesk/pull/1143) |
| BRP-01 | [#304](https://github.com/cisgz3a-hub/KerfDesk/pull/304) | Reject a stale board correction after Undo replaces the captured outline | merged-ci-verified | [#1145](https://github.com/cisgz3a-hub/KerfDesk/pull/1145) |
| B02-TRACE-001 | [#51](https://github.com/cisgz3a-hub/KerfDesk/pull/51) | Close the final fairing span at its actual corner | merged-ci-verified | [#1144](https://github.com/cisgz3a-hub/KerfDesk/pull/1144) |
| B03-CNC-001 | [#74](https://github.com/cisgz3a-hub/KerfDesk/pull/74) | Use a valid containment witness for concave helical pockets | merged-ci-verified | [#1146](https://github.com/cisgz3a-hub/KerfDesk/pull/1146) |
| B03-CNC-002 | [#193](https://github.com/cisgz3a-hub/KerfDesk/pull/193) | Look up manual tab anchors using the source path color | merged-ci-verified | [#1147](https://github.com/cisgz3a-hub/KerfDesk/pull/1147) |
| MTX-001 | [#110](https://github.com/cisgz3a-hub/KerfDesk/pull/110) | Bind Zero Z acknowledgement to the tool that initiated it | merged-ci-verified | [#1148](https://github.com/cisgz3a-hub/KerfDesk/pull/1148) |
| WUX-001 | [#80](https://github.com/cisgz3a-hub/KerfDesk/pull/80) | Imported-program playback uses the background project timing | merged-ci-verified | [#1149](https://github.com/cisgz3a-hub/KerfDesk/pull/1149) |
| B03-VAR-001 | [#58](https://github.com/cisgz3a-hub/KerfDesk/pull/58) | Keep the editable current serial inside the persistence integer domain | merged-ci-verified | [#1150](https://github.com/cisgz3a-hub/KerfDesk/pull/1150) |
| B04-DIAGNOSTIC-001 | See attribution | Opt-in Edge diagnostics use copied settings that differ from the app defaults they claim | merged-ci-verified | [#1152](https://github.com/cisgz3a-hub/KerfDesk/pull/1152) |
| B05-CONSOLE-001 | [#94](https://github.com/cisgz3a-hub/KerfDesk/pull/94) | Combined tool and XY mutations retain stale XY origin evidence | pr-open-ci-pending | [#1162](https://github.com/cisgz3a-hub/KerfDesk/pull/1162) |
| B05-CONSOLE-002 | [#94](https://github.com/cisgz3a-hub/KerfDesk/pull/94) | Firmware-equivalent GRBL numeric spellings preserve stale work Z | pr-open-ci-pending | [#1162](https://github.com/cisgz3a-hub/KerfDesk/pull/1162) |
| B05-C-REALTIME-COMMENTS | [#541](https://github.com/cisgz3a-hub/KerfDesk/pull/541) | Saved G-code comments preserve GRBL realtime command bytes | pr-open-ci-pending | [#1161](https://github.com/cisgz3a-hub/KerfDesk/pull/1161) |
| B05-CONSOLE-003 | [#923](https://github.com/cisgz3a-hub/KerfDesk/pull/923) | Console WCS spellings and comments leave a stale G54 selection | pr-open-ci-pending | [#1162](https://github.com/cisgz3a-hub/KerfDesk/pull/1162) |

Repairs use focused commits and independent main-based PR branches. Commit IDs, local test evidence, current heads and CI check URLs are in repairs.json. A pending CI result is not a passing check; source evidence is separate from deployment, packaging and hardware qualification.

The chronological unstarted cursor is #96; 50 earlier partial scopes also remain. Next action: Independently review and commit this frozen nine-file snapshot, then push a new tracking branch and create a new reviewable tracking PR (previous #1151 is merged). Verify its exact-head CI plus both batch-05 repair heads #1161/#1162, all prior cycles and complete review-comment dispositions. Retain active hosted review IDs and root publication ownership; no batch-06 audit until every cycle passes.

13 of 15 repair groups have completed the entire review/publication/CI cycle. Review follow-ups, unpublished commits, stale review heads and closed-unmerged PRs remain blockers even if an older CI run is green.
