# Functional evidence by interface area

Independent button-audit runs only. Root-owned machine, shell, workspace, browser and build checks are documented separately.

These runs contain **1413 distinct assertions** after accounting for reruns. Their latest raw records contain **1412 passes** and **1 retained failure**. The retained old CommandShell Text-toolbar locator failure is resolved by the separately documented workspace.md targeted rerun. It is not rewritten as a pass in these raw audit logs.

An assertion may test several controls or an underlying store. These counts are not per-button coverage or hardware qualification.

| Area             | Source records | Tested files in these runs | Distinct assertions | Latest raw passes |
| ---------------- | -------------: | -------------------------: | ------------------: | ----------------: |
| app              |             14 |                          6 |                  33 |                33 |
| box              |              8 |                          5 |                  37 |                37 |
| calibration      |              6 |                          4 |                  14 |                14 |
| camera           |             49 |                          6 |                  17 |                17 |
| cnc-viewer3d     |              3 |                          2 |                  15 |                15 |
| commands         |             31 |                         37 |                 209 |               208 |
| common           |             28 |                          0 |                   0 |                 0 |
| design-studio    |             40 |                         29 |                 293 |               293 |
| gcode-inspector  |             21 |                          6 |                  26 |                26 |
| image-editor     |             64 |                         45 |                 314 |               314 |
| kit              |              5 |                          3 |                  16 |                16 |
| laser            |            269 |                          0 |                   0 |                 0 |
| layers           |             92 |                         32 |                 195 |               195 |
| library          |             15 |                          7 |                  45 |                45 |
| machine          |             12 |                          7 |                  44 |                44 |
| material-library |             24 |                          4 |                  24 |                24 |
| raster           |              9 |                          3 |                  18 |                18 |
| relief-viewer    |              2 |                          1 |                   1 |                 1 |
| text             |             29 |                          8 |                  40 |                40 |
| trace            |             19 |                          1 |                   8 |                 8 |
| tutorials        |             17 |                          5 |                  64 |                64 |
| workspace        |             48 |                          0 |                   0 |                 0 |

The zero-test rows for common, laser and workspace refer to this independent subset. [Workspace verification](workspace.md) and [completed-job verification](completion.md) are separate. The integrating audit also records machine controls, browser interaction, screenshots and build checks.

## Retained run reports

| Run                                                                | Files | Assertions | Passed | Failed |
| ------------------------------------------------------------------ | ----: | ---------: | -----: | -----: |
| [functional-tests.json](functional-tests.json)                     |   125 |        906 |    900 |      6 |
| [functional-rerun.json](functional-rerun.json)                     |     8 |         36 |     36 |      0 |
| [remaining-functional-tests.json](remaining-functional-tests.json) |    84 |        464 |    464 |      0 |
| [audit-regressions.json](audit-regressions.json)                   |     3 |         46 |     46 |      0 |

All five original geometry/tutorial timeout assertions passed on the targeted rerun; the worker-termination case also passed. No tests were skipped to obtain those results. The original reports remain available.

Rebuild with `node docs/audits/2026-09-21-interface/summarise-tests.mjs` after regenerating the source inventory. [Detailed summary](button-test-evidence.json) retains the unresolved raw-record pointer and its separately documented resolution.
