# Interface control inventory

Scanned 2623 source files, excluding named .test/.spec files and **fixtures** but including helper modules. Found **805 control definitions and component calls** across 22 UI areas, plus **91 command IDs**. These are source records, not visible button counts or runtime passes.

Base commit: `377e692baf26a9f66ba3877f157213095c54b92f`. SHA-256 of scanned paths and source contents: `8f5e258f3e7949843c05b7660e08060bb5a479e70615177c15a40d757c11d217`.

[Full control and command records](buttons.json) include source location, label expression, handler, disabled expression, visibility conditions, help and test pointers. [CSV](buttons.csv) supports filtering the control records. [Findings and verification](button-findings.md) records functional evidence separately.

## Coverage of the source inventory

| Area             | Source records | Records with nearby test pointers | Distinct nearby test files |
| ---------------- | -------------: | --------------------------------: | -------------------------: |
| app              |             14 |                                13 |                          6 |
| box              |              8 |                                 6 |                          5 |
| calibration      |              6 |                                 6 |                          4 |
| camera           |             49 |                                20 |                          6 |
| cnc-viewer3d     |              3 |                                 3 |                          2 |
| commands         |             31 |                                27 |                          8 |
| common           |             28 |                                20 |                         17 |
| design-studio    |             40 |                                 6 |                          3 |
| gcode-inspector  |             21 |                                17 |                          6 |
| image-editor     |             64 |                                37 |                          5 |
| kit              |              5 |                                 5 |                          3 |
| laser            |            269 |                               152 |                         90 |
| layers           |             92 |                                41 |                         32 |
| library          |             15 |                                 1 |                          1 |
| machine          |             12 |                                11 |                          7 |
| material-library |             24 |                                 9 |                          3 |
| raster           |              9 |                                 6 |                          3 |
| relief-viewer    |              2 |                                 2 |                          1 |
| text             |             29 |                                14 |                          8 |
| trace            |             19 |                                 7 |                          1 |
| tutorials        |             17 |                                 3 |                          2 |
| workspace        |             48 |                                37 |                          7 |

| Record kind           | Count |
| --------------------- | ----: |
| button-component-call |   309 |
| disclosure            |    35 |
| input-control         |    86 |
| link                  |     5 |
| native-button         |   339 |
| other-interactive     |    24 |
| semantic-control      |     7 |

443 records have nearby test pointers; 362 do not. A pointer is a navigation aid, not measured test coverage. 5 records have heuristic review flags; their disposition is in the findings document.

## Command index

Every CommandId is indexed below. Enabled/disabled builder calls and callback expressions are retained in the JSON, including condition-dependent branches. A mapped array can produce many runtime buttons from one source definition.

| Command                                  | Registration references | Explicit ID test references |
| ---------------------------------------- | ----------------------: | --------------------------: |
| file.new                                 |                       1 |                           5 |
| file.open                                |                       1 |                           3 |
| file.save                                |                       1 |                           2 |
| file.save-as                             |                       1 |                           2 |
| file.import                              |                       1 |                           6 |
| file.import-svg                          |                       1 |                           3 |
| file.import-dxf                          |                       1 |                           1 |
| file.import-image                        |                       1 |                           4 |
| file.import-height-map                   |                       1 |                           2 |
| file.save-gcode                          |                       1 |                           5 |
| file.open-gcode                          |                       1 |                           1 |
| file.inspect-gcode                       |                       1 |                           1 |
| edit.undo                                |                       2 |                           1 |
| edit.redo                                |                       2 |                           1 |
| edit.select-all                          |                       1 |                           1 |
| edit.copy                                |                       1 |                           2 |
| edit.cut                                 |                       1 |                           2 |
| edit.paste                               |                       2 |                           3 |
| edit.group                               |                       2 |                           2 |
| edit.ungroup                             |                       2 |                           2 |
| edit.lock-selection                      |                       2 |                           2 |
| edit.unlock-all                          |                       2 |                           2 |
| edit.duplicate                           |                       1 |                           1 |
| edit.delete                              |                       1 |                           1 |
| edit.clear-selection                     |                       1 |                           1 |
| tools.measure                            |                       2 |                           3 |
| tools.add-text                           |                       2 |                           4 |
| tools.registration-jig                   |                       2 |                           1 |
| tools.place-board                        |                       2 |                           2 |
| tools.camera                             |                       2 |                           5 |
| tools.box-generator                      |                       2 |                           2 |
| tools.box-fit-test                       |                       1 |                           1 |
| tools.material-test                      |                       2 |                           2 |
| tools.interval-test                      |                       2 |                           1 |
| tools.scan-offset-test                   |                       2 |                           1 |
| tools.focus-test                         |                       2 |                           1 |
| tools.optimization-settings              |                       2 |                           1 |
| tools.rotary-setup                       |                       2 |                           2 |
| tools.print-and-cut                      |                       3 |                           1 |
| tools.labs                               |                       2 |                           1 |
| tools.adjust-image                       |                       2 |                           2 |
| tools.edit-image                         |                       1 |                           2 |
| tools.apply-image-mask                   |                       3 |                           2 |
| tools.crop-image                         |                       3 |                           2 |
| tools.remove-image-mask                  |                       3 |                           2 |
| tools.save-processed-bitmap              |                       2 |                           1 |
| tools.trace-image                        |                       2 |                           9 |
| tools.retrace-original                   |                       3 |                           2 |
| tools.multi-file-trace                   |                       2 |                           2 |
| tools.convert-to-path                    |                       3 |                           2 |
| tools.weld                               |                       3 |                           2 |
| tools.subtract                           |                       3 |                           1 |
| tools.intersect                          |                       3 |                           1 |
| tools.exclude                            |                       3 |                           1 |
| tools.convert-to-bitmap                  |                       3 |                           2 |
| tools.fill-selection                     |                       3 |                           2 |
| tools.close-open-fill-contours           |                       3 |                           2 |
| tools.close-fill-contours-with-tolerance |                       3 |                           2 |
| arrange.align-left                       |                       1 |                           3 |
| arrange.align-center-x                   |                       1 |                           1 |
| arrange.align-right                      |                       1 |                           1 |
| arrange.align-top                        |                       1 |                           1 |
| arrange.align-center-y                   |                       1 |                           1 |
| arrange.align-bottom                     |                       1 |                           1 |
| arrange.align-centers                    |                       1 |                           1 |
| arrange.distribute-horizontal-centers    |                       1 |                           1 |
| arrange.distribute-horizontal-spacing    |                       1 |                           1 |
| arrange.distribute-vertical-centers      |                       1 |                           1 |
| arrange.distribute-vertical-spacing      |                       1 |                           1 |
| arrange.break-apart                      |                       2 |                           3 |
| arrange.array                            |                       2 |                           1 |
| arrange.quick-nest                       |                       2 |                           1 |
| arrange.flip-horizontal                  |                       2 |                           2 |
| arrange.flip-vertical                    |                       2 |                           1 |
| laser.connect                            |                       2 |                           3 |
| laser.disconnect                         |                       2 |                           1 |
| laser.home                               |                       2 |                           1 |
| window.toggle-preview                    |                       1 |                           6 |
| window.toggle-layers-panel               |                       1 |                           2 |
| window.toggle-machine-panel              |                       1 |                           2 |
| window.toggle-side-panels                |                       1 |                           2 |
| window.reset-layout                      |                       1 |                           1 |
| window.fit-view                          |                       1 |                           2 |
| window.project-notes                     |                       1 |                           1 |
| window.undo-history                      |                       1 |                           1 |
| help.about                               |                       1 |                           1 |
| help.tutorials                           |                       1 |                           1 |
| help.connection                          |                       1 |                           1 |
| help.safety                              |                       1 |                           1 |
| help.report-bug                          |                       1 |                           1 |
| help.discussions                         |                       1 |                           1 |

## Rebuild and limits

Run from the repository root:

```sh
node docs/audits/2026-09-21-interface/inventory-buttons.mjs
```

- Static source definitions, not the number of visible buttons or distinct runtime instances. Reusable definitions and their call sites intentionally coexist.
- Mapped lists, conditional rendering, spread props, inherited native behavior and hook callbacks require runtime checking.
- Visibility conditions list JSX ancestor guards only; early returns, parent-component prerequisites and dynamically generated names are not fully resolved.
- Nearby tests are discovery pointers, never proof that a specific control passed. Test results are reported separately.
- Review flags are heuristic candidates, not confirmed defects. Input text/range/select fields, canvas gestures and native desktop menus are outside this button catalog.
- No hardware, controller, material, or external-service operation was performed for this inventory.
