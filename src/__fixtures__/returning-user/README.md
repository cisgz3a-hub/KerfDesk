# Golden projects from real releases

Each `.lf2.gz` was saved by the release it names, through that release's own `buildTextObject`,
store and `prepareProjectForPersistence`, from a `git archive` of its tag commit. Nothing here is
hand-shaped. `src/ui/text/returning-user-*.test.ts` open them through `deserializeProject` and the
store, compile them to G-code, and compare with the sidecar.

- 1.0.27 is `adf300522` (schema 18). 1.0.28 is `33bc394c6` (schema 19). 1.0.29 is `df2279e26`
  (schema 21).
- The CNC files' sidecars `1.0.28-cnc-job-origin.cuts.json` and `1.0.29-cnc-job-origin.cuts.json`
  hold where that release cut each one, read with `cnc-cut-extent.ts` (rolling audit v9 R8-P2-1).
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
| `1.0.29-repaired-frames`               | 1.0.27, then saved on 1.0.28, then opened and saved on 1.0.29 | The 1.0.28-converted frames with the line rule 1.0.29 gave back at open |
| `1.0.29-line-rule-frames`              | 1.0.27, then opened on 1.0.29, every text rebuilt, saved   | Single-line frames that keep their line rule through an edit              |
| `1.0.29-placed-tabs`                   | 1.0.29                                                    | Laser tabs placed by hand, then a toolbar 2× width and a handle-drag height |
| `1.0.29-fill-pool`                     | 1.0.29                                                    | A square and a circle in one Fill pool, beside another Fill operation     |
| `1.0.29-photo-recipe`                  | 1.0.29                                                    | Wood and Slate recipes with Auto tones from the dialog's preview histogram |
| `1.0.29-unaffected`                    | 1.0.29                                                    | Nothing a later release should change: the notices stay silent            |
| `1.0.29-cnc-bowtie-pocket`             | 1.0.29                                                    | The 1.0.28 Pocket bowtie, cut at the canvas anchor                        |
| `1.0.29-cnc-flat-drill`                | 1.0.29                                                    | The 1.0.28 flat Drill contour, cut at the canvas anchor                   |
| `1.0.29-white-logos`                   | 1.0.29                                                    | U3's logo, a white-letter plate, a style and class logo, and the logo with its white on Output off |
| `1.0.29-white-logo-copies`             | 1.0.29                                                    | U3's logo with two Array copies and a moved Duplicate, which lost `svgImport` |

The 1.0.29 set was built through 1.0.29's store actions: Import, Draw, the laser tab tool, the
toolbar and a handle drag, the operation settings, and the Photo engraving dialog's own preview,
recipe patch and Apply update. Its `1.0.29-fill-pool.burns.json` also holds the whole job
(`whole-job`), since a pool burns only together, and `1.0.29-placed-tabs.burns.json` holds where
1.0.29 burned each tab, read with `burned-tab-spans.ts` (`tabSpans`). `returning-user-1-0-29.test.ts`
reads them.

`1.0.29-white-logos` (rolling audit v10 V2-P2-1) was imported through 1.0.29's own `parseSvg` and
store Import, so its white shapes burn over the black, and the last logo's white operation was set
to Output off with `setLayerParam`. Its sidecar holds each import's burn (by `svgImport.source`)
and the whole job. `returning-user-white-fills.test.ts` reads it.

`1.0.29-white-logo-copies` (rolling audit v12 X2-P1-1) is U3's logo imported the same way, then
copied with 1.0.29's Array (`placeSelectionCopies`, two copies beside it) and Duplicate (moved below
with `applyObjectTransform`). 1.0.29's copies drop `svgImport`, so only the original keeps it
(`withSvgImport: 1` in the sidecar). Its sidecar holds each object's burn and the whole job.
`returning-user-white-copies.test.ts` reads it.

Browser storage and projects saved by 1.0.28's own hooks and store, the same way (rolling audit v9
R6): a temporary test under the export's `src` drove the Studio's Apply with its persistence hook
mounted, and connected its laser store to the published A1 Pro banner and `$$` with its profile
persistence hook mounted. The 1.0.29 last machine was made by 1.0.29's own `initDeviceSetup`,
`planControllerAutoFill`, `deviceSetupReducer`, `machineSetupProfile` and `rememberLastMachine`
(rolling audit v10's refuter bundle of `df2279e26`).

| File                                      | Read by                                        | Holds                                                                    |
| ----------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| `1.0.28-studio-storage.json`              | `design-kept-drawings-copies.test.tsx`         | The Studio's saved drawing (3 lines applied) and a kept drawing (2 lines never applied) |
| `1.0.28-studio-older.lf2`                 | `design-kept-drawings-copies.test.tsx`         | That project after its first Apply (1 line), as an older autosave         |
| `1.0.28-studio-newer.lf2`                 | `design-kept-drawings-copies.test.tsx`         | That project after its second Apply (3 lines)                             |
| `1.0.28-a1-pro-widened-last-machine.json` | `falcon-a1-pro-connect-home.simulator.test.ts` | The last-machine document after Use detected values: bed 363 × 273 mm     |
| `1.0.29-laser-made-cnc-last-machine.json` | `converted-laser-question.test.ts`, `converted-laser-question.e2e.ts` | The laser starter after 1.0.29's first Connect to a stock-GRBL `$$` (`$30=1000`, `$32=0`): saved as a CNC (U8-P2-1, V2-P2-2) |

Add one set per release at release time. To make one, export the release into a folder inside your
worktree, build the scene in a temporary test under its `src`, save with its
`prepareProjectForPersistence`, measure with this folder's reading, and run Vitest with `--root`.
