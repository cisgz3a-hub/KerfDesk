# Registered command dispatch audit

All 91 registered commands were activated through their real menu rows. The 89 callback/navigation results are boundary checks, Learn changes the real tutorial store, and Focus Test is intentionally unavailable. This is not a claim of 91 hardware/native/geometry end-to-end tests. Independent per-command expectations live in the test source.

| Command | Expected dispatch | Disposition |
| --- | --- | --- |
| file.new | newProject; confirm: start a new project | verified-boundary |
| file.open | openProject | verified-boundary |
| file.save | saveProject | verified-boundary |
| file.save-as | saveProjectAs | verified-boundary |
| file.import | importArtwork | verified-boundary |
| file.import-svg | importSvg | verified-boundary |
| file.import-dxf | importDxf | verified-boundary |
| file.import-image | importImage | verified-boundary |
| file.import-height-map | importHeightMap | verified-boundary |
| file.save-gcode | saveGcode | verified-boundary |
| file.open-gcode | openGcodePreview | verified-boundary |
| file.inspect-gcode | inspectCurrentGcode | verified-boundary |
| edit.undo | undo | verified-boundary |
| edit.redo | redo | verified-boundary |
| edit.select-all | selectAll | verified-boundary |
| edit.copy | copySelection | verified-boundary |
| edit.cut | cutSelection | verified-boundary |
| edit.paste | pasteClipboard | verified-boundary |
| edit.group | groupSelection | verified-boundary |
| edit.ungroup | ungroupSelection | verified-boundary |
| edit.lock-selection | lockSelection | verified-boundary |
| edit.unlock-all | unlockAllObjects | verified-boundary |
| edit.duplicate | duplicateSelection | verified-boundary |
| edit.delete | deleteSelection | verified-boundary |
| edit.clear-selection | clearSelection | verified-boundary |
| tools.measure | measureTool | verified-boundary |
| tools.add-text | addText | verified-boundary |
| tools.registration-jig | toggleRegistrationPanel | verified-boundary |
| tools.place-board | toggleBoardCapturePanel | verified-boundary |
| tools.camera | toggleCameraPanel | verified-boundary |
| tools.box-generator | boxGenerator | verified-boundary |
| tools.box-fit-test | boxFitTest | verified-boundary |
| tools.material-test | materialTest; confirm: create a material test | verified-boundary |
| tools.interval-test | intervalTest; confirm: create an interval test | verified-boundary |
| tools.scan-offset-test | scanOffsetTest; confirm: create a scan offset test | verified-boundary |
| tools.focus-test | unavailable | intentionally-unavailable |
| tools.optimization-settings | optimizationSettings | verified-boundary |
| tools.rotary-setup | rotarySetup | verified-boundary |
| tools.print-and-cut | printAndCut | verified-boundary |
| tools.labs | labsSettings | verified-boundary |
| tools.adjust-image | adjustImage | verified-boundary |
| tools.edit-image | editImage | verified-boundary |
| tools.apply-image-mask | applyImageMask | verified-boundary |
| tools.crop-image | cropImage | verified-boundary |
| tools.remove-image-mask | removeImageMask | verified-boundary |
| tools.save-processed-bitmap | saveProcessedBitmap | verified-boundary |
| tools.trace-image | traceImage | verified-boundary |
| tools.retrace-original | retraceOriginal | verified-boundary |
| tools.multi-file-trace | multiFileTrace | verified-boundary |
| tools.convert-to-path | convertSelectionToPath | verified-boundary |
| tools.weld | weldSelection | verified-boundary |
| tools.subtract | subtractSelection | verified-boundary |
| tools.intersect | intersectSelection | verified-boundary |
| tools.exclude | excludeSelection | verified-boundary |
| tools.convert-to-bitmap | convertToBitmap | verified-boundary |
| tools.fill-selection | fillSelectionSeparately | verified-boundary |
| tools.close-open-fill-contours | closeSelectedOpenFillContours | verified-boundary |
| tools.close-fill-contours-with-tolerance | reviewCloseOpenFillContours | verified-boundary |
| arrange.align-left | alignSelection(left) | verified-boundary |
| arrange.align-center-x | alignSelection(center-x) | verified-boundary |
| arrange.align-right | alignSelection(right) | verified-boundary |
| arrange.align-top | alignSelection(top) | verified-boundary |
| arrange.align-center-y | alignSelection(center-y) | verified-boundary |
| arrange.align-bottom | alignSelection(bottom) | verified-boundary |
| arrange.align-centers | alignSelection(centers) | verified-boundary |
| arrange.distribute-horizontal-centers | distributeSelection(horizontal-centers) | verified-boundary |
| arrange.distribute-horizontal-spacing | distributeSelection(horizontal-spacing) | verified-boundary |
| arrange.distribute-vertical-centers | distributeSelection(vertical-centers) | verified-boundary |
| arrange.distribute-vertical-spacing | distributeSelection(vertical-spacing) | verified-boundary |
| arrange.break-apart | breakApartSelection | verified-boundary |
| arrange.array | createArray | verified-boundary |
| arrange.quick-nest | quickNest | verified-boundary |
| arrange.flip-horizontal | flipHorizontal | verified-boundary |
| arrange.flip-vertical | flipVertical | verified-boundary |
| laser.connect | connectLaser | verified-boundary |
| laser.disconnect | disconnectLaser | verified-boundary |
| laser.home | homeLaser | verified-boundary |
| window.toggle-preview | togglePreview | verified-boundary |
| window.toggle-layers-panel | toggleLayersPanel | verified-boundary |
| window.toggle-machine-panel | toggleMachinePanel | verified-boundary |
| window.toggle-side-panels | toggleSidePanels | verified-boundary |
| window.reset-layout | resetWorkspaceLayout | verified-boundary |
| window.fit-view | resetView | verified-boundary |
| window.project-notes | projectNotes | verified-boundary |
| window.undo-history | undoHistory | verified-boundary |
| help.about | showAbout | verified-boundary |
| help.tutorials | tutorials | verified-behaviour |
| help.connection | showConnectionHelp | verified-boundary |
| help.safety | showSafety | verified-boundary |
| help.report-bug | https://github.com/cisgz3a-hub/KerfDesk/issues/new/choose | verified-boundary |
| help.discussions | https://github.com/cisgz3a-hub/KerfDesk/discussions | verified-boundary |

Exact passing cases and raw report links are recorded in [JSON](control-audit-commands.json).
