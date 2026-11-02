# Golden projects from real releases

Each `.lf2.gz` was saved by the release it names, through that release's own `buildTextObject`,
store and `prepareProjectForPersistence`, from a `git archive` of its tag commit. Nothing here is
hand-shaped. `src/ui/text/returning-user-*.test.ts` open them through `deserializeProject` and the
store, compile them to G-code, and compare with the sidecar.

- 1.0.27 is `adf300522` (schema 18). 1.0.28 is `33bc394c6` (schema 19).
- The CNC files' sidecar `1.0.28-cnc-job-origin.cuts.json` holds where 1.0.28 cut each one, read
  with `cnc-cut-extent.ts` (rolling audit v9 R8-P2-1).
- `*.burns.json` holds the burn of each object and each CSV record, measured on the saving release
  with `burn-metrics.ts`. A deliberate burn change updates the test's expectation with its ADR
  number; it never rewrites a sidecar.

| File                                   | Saved by                                                  | Holds                                                                     |
| -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `1.0.27-text-frames`                   | 1.0.27                                                    | Relief, Casual Hand, Nixish and Decorous shrink frames; plain frames      |
| `1.0.27-text-frames-via-1.0.28`        | 1.0.27, then opened and saved on 1.0.28                   | The same, with the frame rule lost (R7-P1-1)                              |
| `1.0.27-text-frames-edited-on-1.0.28`  | 1.0.27, then opened on 1.0.28, every text rebuilt, saved  | Frames that really are under the em rule now                              |
| `1.0.28-fresh-frames`                  | 1.0.28                                                    | Frames made at the new sizes                                              |
| `1.0.27-whole-job`                     | 1.0.27                                                    | Relief frame, bent record, Grayscale Dot Width, turned Pass-Through, tabs, sketch |
| `1.0.27-whole-job-via-1.0.28`          | 1.0.27, then opened and saved on 1.0.28                   | The same                                                                  |
| `1.0.27-cnc`                           | 1.0.27                                                    | A CNC profile on a near-closed outline                                    |
| `1.0.27-unaffected`, `1.0.28-unaffected` | The release named                                       | Nothing the upgrade changes: the notices stay silent                      |
| `1.0.28-cnc-bowtie-pocket`             | 1.0.28                                                    | A Pocket crossing loop beside a square, User Origin front-left            |
| `1.0.28-cnc-flat-drill`                | 1.0.28                                                    | A flat Drill contour beside a square, User Origin centre                  |
| `1.0.28-cnc-bowtie-absolute`           | 1.0.28                                                    | The Pocket bowtie on Absolute: no move, no notice                         |

Add one set per release at release time. To make one, export the release into a folder inside your
worktree, build the scene in a temporary test under its `src`, save with its
`prepareProjectForPersistence`, measure with this folder's reading, and run Vitest with `--root`.
