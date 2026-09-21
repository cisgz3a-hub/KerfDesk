# Button audit findings and evidence

This audit indexes the complete production renderer source for button definitions and related interactive controls. It also exercises existing functional tests across the command registry and UI areas. A static handler, a nearby test file, and a successful machine action are different kinds of evidence. The inventory does not certify every rendered instance, state combination, controller, or material operation.

The source inventory is [buttons.md](buttons.md), with individual handler, disabled, visibility and help expressions in [buttons.json](buttons.json) and a filterable [CSV](buttons.csv). The source digest in the generated inventory identifies the scanned working-tree content, including changes beyond its base commit. The scanned corpus excludes named test/spec files and fixtures; helper modules remain in the corpus, so the scanned-file count is not a production reachability count.

## Confirmed interaction defects repaired

| Finding | Before | After | Verification |
| --- | --- | --- | --- |
| Image Studio operation menus were incomplete for keyboard use | Arrow keys did not open Image/Adjust/Filter menus; the menus did not provide focus navigation or Escape/Tab dismissal. Selecting a menu item removed the focused item without restoring a stable target. | Arrow Down/Up open at the first/last item; arrow keys, Home and End move focus; Escape and Tab dismiss; action selection restores the trigger before opening its dialog. Long menus scroll within a bounded height. | Three regression cases failed before the fix. Four cases now cover navigation, action-to-dialog handoff, dismissal and transform availability. |
| Image Studio exposed actions that silently did nothing during Free Transform | Image/Adjust/Filter entries appeared available, but their action stores explicitly refused an unfinished transform. | These menu triggers are disabled during the transform and explain how to finish or cancel it with Enter/Esc. They become usable again after the transform ends. Existing transform and image-operation behavior is preserved. | Regression verifies all three menu triggers are disabled with a reason, then available again after cancellation. |
| Run Order selection required a mouse | The selectable run card was an article with an onClick handler, while keyboard users could reach only its position field and Edit settings button. | The existing run name is a native, focusable selection button, with the current selection exposed by aria-pressed. Selecting the name invokes the action once and does not open settings. | Focus and dispatch regression in ArtworkRunOrderList.test.tsx. |

Implementation files: [Image Studio operation menus](../../../src/ui/image-editor/EditorAdjustMenus.tsx), [menu regressions](../../../src/ui/image-editor/EditorAdjustMenus.test.tsx), [Run Order row](../../../src/ui/layers/ArtworkRunOrderRow.tsx), [Run Order regressions](../../../src/ui/layers/ArtworkRunOrderList.test.tsx).

## Source review disposition

The source scan found no empty direct native-button handlers, missing direct native-button handlers without spread props or submit/reset behavior, or native buttons missing all direct accessible-name sources. That is a source finding, not proof that every callback performs the intended action.

Five nonsemantic interaction candidates were individually reviewed:

| Source | Disposition |
| --- | --- |
| camera/NetworkCameraView.tsx image click | Spatial corner-picking surface, not an ordinary button. Camera acquisition and physical calibration remain unverified. |
| design-studio/ShapeInspector.tsx pointer-down header | Inspector drag handle, not a discrete button action. |
| image-editor/EditorAdjustMenus.tsx hidden catcher | Pointer-only dismiss backdrop, hidden from assistive technology. Escape/Tab provide the keyboard dismissal after this fix. |
| layers/ArtworkRunOrderRow.tsx article click | Optional whole-card click remains; the new native run-name button supplies the keyboard selection action. |
| layers/ArtworkRunOrderRow.tsx label click | Stops propagation so editing the run position does not inadvertently select the card. Native input behavior remains available. |

**Focus Test is intentionally unavailable.** The command is permanently disabled in command-families.ts because its dedicated, hardware-verified Z-motion generator does not exist. The existing regression verifies that even a profile advertising Z support cannot enable it. It must not be presented as a working calibration feature or enabled by a cosmetic UI change.

## Functional execution evidence

The initial audit ran commands, tutorials, design library, material library, Image Studio and Design Studio suites: **906 assertions, 900 passed and 6 failed**. [Original JSON](functional-tests.json) is retained. One failure was the Text toolbar test looking for its old always-visible location during the coordinated toolbar simplification; the workspace owner updated it to the current More-menu route. Five assertions hit the default test timeout under concurrent host load. A worker termination timeout was also reported.

Only the failures, worker-termination case and changed UI areas were rerun with one worker. That run passed **36/36 assertions in 8 files**, including the geometry and tutorial-rendering cases that had timed out. [Rerun JSON](functional-rerun.json) is retained. These results are jsdom/store/geometry evidence, not browser, controller, or hardware evidence.

[Remaining test paths](remaining-test-paths.json) lists 84 unique test files discovered through inventory pointers in 13 additional UI areas: app, box, calibration, camera, CNC viewer, G-code inspector, kit, layers, machine, raster, relief viewer, text and trace. This run passed **464/464 assertions in 84 files** with one worker. [Result JSON](remaining-functional-tests.json) is retained. Root-owned machine, toolbar, workspace and browser verification is reported with the integrated change.

The catalog also identified 22 command IDs without an explicit named test reference. The added [command gap cases](../../../src/ui/commands/command-audit-gaps.test.ts) assert their intended callbacks, exact align/distribute arguments, and unavailable-state reasons. **39 command cases** plus the final menu and run-row checks passed **46/46 assertions in 3 files** after the final component extraction. [Final regression JSON](audit-regressions.json) is retained.

[Per-area functional evidence](button-test-evidence.md) accounts for reruns and repeated parameterised test names: **1,413 distinct assertions**, with **1,412 latest raw passes** and the old Text locator failure. That last failure is resolved in the separately documented [workspace targeted rerun](workspace.md), which passed all 16 tests in the three affected suites. Original failures are deliberately retained; no unresolved functional failure remains from these audit runs. These figures are not a count of tested buttons.

Some records lack nearby test pointers because reusable controls are tested through a parent or their stores. Others need additional runtime coverage. The generated area table deliberately reports pointer counts, not coverage percentages. No successful test is extrapolated into a claim that all inventory records passed.

## Boundaries

- No hardware was connected, moved, homed, probed, fired or started as part of this audit.
- Camera devices, operating-system file dialogs, external support pages, desktop updater/install flows and controller-specific transport behavior need their own applicable environment checks.
- The catalog includes native buttons, reusable button calls, disclosures, button-like inputs, action links and other JSX click targets. Text/range/select fields, canvas gesture combinations and native desktop menus are not an exhaustive part of this button inventory.
- Existing tests are sampled functional evidence across the interface. An exhaustive browser activation of every dynamic instance in every state has not been performed.
