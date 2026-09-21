# Interface control inventory

Scanned 2635 source files, excluding named .test/.spec files and **fixtures** but including helper modules. Found **815 control definitions and component calls** across 22 UI areas, plus **94 command IDs**. These are source records, not visible button counts or runtime passes.

Base commit: `ef151088b45a119e5dc9d192fed2e07493c950a2`. SHA-256 of scanned paths and source contents: `c4256ab394fe578f8391e0df5346e8eb4bc6b4ac1f4f60a5a81d5a16ee9b5e29`.

[Full control and command records](buttons.json) include source location, label expression, handler, disabled expression, visibility conditions, help and test pointers. [CSV](buttons.csv) supports filtering the control records. [Findings and verification](../button-findings.md) records functional evidence separately.

## Coverage of the source inventory

| Area             | Source records | Records with nearby test pointers | Distinct nearby test files |
| ---------------- | -------------: | --------------------------------: | -------------------------: |
| app              |             14 |                                14 |                          7 |
| box              |              8 |                                 8 |                          6 |
| calibration      |              6 |                                 6 |                          4 |
| camera           |             49 |                                42 |                         12 |
| cnc-viewer3d     |              3 |                                 3 |                          2 |
| commands         |             31 |                                27 |                          9 |
| common           |             28 |                                20 |                         17 |
| design-studio    |             40 |                                31 |                          6 |
| gcode-inspector  |             21 |                                20 |                          7 |
| image-editor     |             64 |                                64 |                          9 |
| kit              |              5 |                                 5 |                          4 |
| laser            |            279 |                               229 |                         92 |
| layers           |             92 |                                55 |                         36 |
| library          |             15 |                                 7 |                          2 |
| machine          |             12 |                                11 |                          8 |
| material-library |             24 |                                10 |                          5 |
| raster           |              9 |                                 6 |                          4 |
| relief-viewer    |              2 |                                 2 |                          1 |
| text             |             29 |                                24 |                          9 |
| trace            |             19 |                                12 |                          2 |
| tutorials        |             17 |                                17 |                          3 |
| workspace        |             48 |                                39 |                          9 |

| Record kind           | Count |
| --------------------- | ----: |
| button-component-call |   309 |
| disclosure            |    44 |
| input-control         |    87 |
| link                  |     5 |
| native-button         |   339 |
| other-interactive     |    24 |
| semantic-control      |     7 |

652 records have nearby test pointers; 163 do not. A pointer is a navigation aid, not measured test coverage. 5 records have heuristic review flags; their disposition is in the findings document.

## Command index

Every CommandId is indexed below. Enabled/disabled builder calls and callback expressions are retained in the JSON, including condition-dependent branches. A mapped array can produce many runtime buttons from one source definition.

| Command                                  | Registration references | Explicit ID test references |
| ---------------------------------------- | ----------------------: | --------------------------: |
| file.new                                 |                       1 |                           6 |
| file.open                                |                       1 |                           4 |
| file.save                                |                       1 |                           3 |
| file.save-as                             |                       1 |                           3 |
| file.import                              |                       1 |                           7 |
| file.import-svg                          |                       1 |                           4 |
| file.import-dxf                          |                       1 |                           2 |
| file.import-image                        |                       1 |                           7 |
| file.import-height-map                   |                       1 |                           3 |
| file.save-gcode                          |                       1 |                           6 |
| file.open-gcode                          |                       1 |                           2 |
| file.inspect-gcode                       |                       1 |                           2 |
| edit.undo                                |                       2 |                           2 |
| edit.redo                                |                       2 |                           2 |
| edit.select-all                          |                       1 |                           2 |
| edit.copy                                |                       1 |                           3 |
| edit.cut                                 |                       1 |                           3 |
| edit.paste                               |                       2 |                           4 |
| edit.group                               |                       2 |                           3 |
| edit.ungroup                             |                       2 |                           3 |
| edit.lock-selection                      |                       2 |                           3 |
| edit.unlock-all                          |                       2 |                           3 |
| edit.duplicate                           |                       1 |                           2 |
| edit.delete                              |                       1 |                           2 |
| edit.clear-selection                     |                       1 |                           2 |
| tools.measure                            |                       2 |                           4 |
| tools.add-text                           |                       2 |                           5 |
| tools.registration-jig                   |                       2 |                           2 |
| tools.place-board                        |                       2 |                           3 |
| tools.camera                             |                       2 |                           6 |
| tools.box-generator                      |                       2 |                           3 |
| tools.box-fit-test                       |                       1 |                           2 |
| tools.material-test                      |                       2 |                           3 |
| tools.interval-test                      |                       2 |                           2 |
| tools.scan-offset-test                   |                       2 |                           2 |
| tools.focus-test                         |                       2 |                           2 |
| tools.optimization-settings              |                       2 |                           2 |
| tools.rotary-setup                       |                       2 |                           3 |
| tools.print-and-cut                      |                       3 |                           2 |
| tools.labs                               |                       2 |                           2 |
| tools.adjust-image                       |                       2 |                           3 |
| tools.edit-image                         |                       2 |                           3 |
| tools.apply-image-mask                   |                       3 |                           3 |
| tools.crop-image                         |                       3 |                           3 |
| tools.remove-image-mask                  |                       3 |                           3 |
| tools.save-processed-bitmap              |                       2 |                           2 |
| tools.trace-image                        |                       2 |                          10 |
| tools.retrace-original                   |                       3 |                           3 |
| tools.multi-file-trace                   |                       2 |                           3 |
| tools.convert-to-path                    |                       3 |                           3 |
| tools.weld                               |                       3 |                           3 |
| tools.subtract                           |                       3 |                           2 |
| tools.intersect                          |                       3 |                           2 |
| tools.exclude                            |                       3 |                           2 |
| tools.convert-to-bitmap                  |                       3 |                           3 |
| tools.fill-selection                     |                       3 |                           3 |
| tools.close-open-fill-contours           |                       3 |                           3 |
| tools.close-fill-contours-with-tolerance |                       3 |                           3 |
| arrange.align-left                       |                       1 |                           4 |
| arrange.align-center-x                   |                       1 |                           2 |
| arrange.align-right                      |                       1 |                           2 |
| arrange.align-top                        |                       1 |                           2 |
| arrange.align-center-y                   |                       1 |                           2 |
| arrange.align-bottom                     |                       1 |                           2 |
| arrange.align-centers                    |                       1 |                           2 |
| arrange.distribute-horizontal-centers    |                       1 |                           2 |
| arrange.distribute-horizontal-spacing    |                       1 |                           2 |
| arrange.distribute-vertical-centers      |                       1 |                           2 |
| arrange.distribute-vertical-spacing      |                       1 |                           2 |
| arrange.break-apart                      |                       2 |                           4 |
| arrange.array                            |                       2 |                           2 |
| arrange.quick-nest                       |                       2 |                           2 |
| arrange.flip-horizontal                  |                       2 |                           3 |
| arrange.flip-vertical                    |                       2 |                           2 |
| laser.connect                            |                       2 |                           4 |
| laser.disconnect                         |                       2 |                           2 |
| laser.home                               |                       2 |                           2 |
| window.toggle-preview                    |                       2 |                           7 |
| window.toggle-layers-panel               |                       2 |                           3 |
| window.toggle-machine-panel              |                       2 |                           3 |
| window.toggle-side-panels                |                       2 |                           3 |
| window.reset-layout                      |                       2 |                           2 |
| window.theme-light                       |                       2 |                           1 |
| window.theme-dark                        |                       2 |                           1 |
| window.theme-system                      |                       2 |                           1 |
| window.fit-view                          |                       2 |                           3 |
| window.project-notes                     |                       2 |                           2 |
| window.undo-history                      |                       2 |                           2 |
| help.about                               |                       1 |                           2 |
| help.tutorials                           |                       1 |                           2 |
| help.connection                          |                       1 |                           2 |
| help.safety                              |                       1 |                           2 |
| help.report-bug                          |                       1 |                           2 |
| help.discussions                         |                       1 |                           2 |

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
