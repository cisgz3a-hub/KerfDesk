# T18 Flatten Image Mask — refuter report
Tree: origin/main @ 49ced452b (read-only). Command id: `tools.flatten-image-mask`.
Method: my own Vitest file `C:\Users\stolk\kd-t1\zz-t18r\t18r.test.tsx` (config `vitest.config.mts`, log `t18r.log`). It renders the **real `useAppCommands` hook**, which builds the AppCommand objects that the menu bar, the right-click menu and shortcuts all read. It drives the real store actions: `drawShape` with `createEllipse`, `importRasterImage`, `selectObject`, `toggleSelectObject` (shift-click on the canvas or in the Objects panel), `selectObjects` fed by the real `selectObjectsInMarquee`, `selectAllObjects` and the real `arrange.bring-to-front` command. It also uses the real canvas `hitTestDetailed`, and it invokes the real `tools.apply-image-mask` command. Nothing comes from the auditor's scratch directory. Run: `--maxWorkers=1`, 6 tests passed, about 40 s.

## Verdicts
**T18-P2-1: CONFIRMED, P2.** Flatten, Crop and Remove Image Mask are all disabled after Apply Mask whenever the mask comes before the image in scene order. It happens on every selection path I tried. Even clicking the photo first does not help.

## Evidence
- **Apply Mask leaves both objects selected.** `applyMask` (`src/ui/state/image-mask-actions.ts:22-38`) returns no `selectedObjectId` or `additionalSelectedIds`, so the pair stays selected. The log agrees: "after Apply: … primary=circle extra=[photo] imageMaskId=circle". By contrast, `cropMask` and `flattenImageMask` select the image alone. So the state the claim describes is the normal state right after Apply Mask, not a rare one.
- **R1, natural order.** Import the photo, draw the circle over it, click the photo, shift-click the circle: order `photo,circle`. Flatten, Crop and Remove are all **ENABLED**.
- **R2, coaster order.** Draw the circle, then import the photo: order `circle,photo`. Import and draw both append, so the newer object lands later in `scene.objects`.
  - The photo now covers the circle. A click on the circle's stroke inside the photo picks `{"id":"photo"}` (`hit-test.ts`: "An object painted over the point hides everything beneath it"). So the user selects both with a box: a crossing marquee gives `circle,photo`, primary=circle.
  - Apply Mask is enabled and applies. After it, Flatten, Crop and Remove are all **disabled**, with the reason "Select an image that already has a mask."
  - Invoking the disabled Flatten anyway changes nothing and shows no toast.
  - Clicking the photo alone enables Flatten. This is the workaround.
- **R3, click order does not count.** In coaster order: click the photo (primary=photo), then shift-click the circle. Primary becomes **circle**. The store's type comment says "Shift+click toggle; never clears the primary" (`store.ts`), but `toggleSelectionFromId` → `selectionStateFromIds` → `orderedLiveIds` (`scene-group-actions.ts:51-71,169-231`) re-sorts by `scene.objects` order. After Apply, all three commands are disabled. Even a user who clicks the image first is refused.
- **R4, Ctrl+A.** Select All gives primary=circle in coaster order. All three commands are disabled.
- **R5, Bring to Front.** In natural order with the mask applied, the commands are enabled. Then Bring photo to Front: `moveObjectsInDrawOrder` restacks `scene.objects` to `circle,photo`. After reselecting both, all three commands are disabled. Send circle to Back has the same effect, since it uses the same restack.
- **The paths I could reach all share one gate.** The menu bar, the right-click menu and shortcuts read the same AppCommand objects from `useAppCommands`, so they share `hasMaskedRasterSelection` (`use-app-commands.ts:125-126`). Flatten's handler gets `selected` from `app.selectedObjectId` (`design-tools-command-context.ts:28-29,41`). Crop and Remove use `selected` as well (`image-command-actions.ts:76-97`). There is no toolbar or Properties-panel entry for these commands (grep: `tools.crop-image` and `tools.flatten-image-mask` appear only in the menu groups and the context list). Flatten is not on the right-click menu at all (X1 below).
- **Severity.** I kept P2; I did not lower it to P3.
  - This is the AREAS.md P2 case "a refusal that should not happen". The same two-object selection is accepted or refused depending on stacking order, which the user cannot see, and even on how the selection was made (R3).
  - Apply Mask's own gate accepts either order (`selectedImageMaskPair`).
  - The reason text is misleading: an image with a mask is selected. It does not say "select the image alone".
  - Harm is limited: there is no burn change and one click is the workaround. That keeps it at P2, not P1.
  - It is not P3, because there is a real order-dependent gate defect behind the wording.
- **Scope beyond the auditor's claim.** Remove Image Mask is affected too (`command-families.ts:196-211`), not only Flatten and Crop.

## Extra findings
### T18R-P3-1: Flatten Image Mask is missing from the canvas right-click menu, while Apply Mask, Crop Image and Remove Image Mask are on it
- **Severity: P3 (discoverability and LightBurn parity, no wrong result).** The Tools → Image menu still works. LightBurn's documented entry point is right-clicking the masked image → Flatten Image Mask; this is the auditor's own LightBurn row, and ADR-480 D9 places it only "Tools → Image, beside Crop Image". The KerfDesk right-click menu offers the three sibling commands but not this one.
- **Where.** `src/ui/commands/workspace-context-commands.ts:70-72` (`SELECTION_MORE_COMMANDS` has `tools.apply-image-mask`, `tools.crop-image` and `tools.remove-image-mask`, with no `tools.flatten-image-mask`).
- **Repro.** t18r X1 runs the real `primaryWorkspaceContextCommands` and `moreWorkspaceContextCommands` for `'workspace-selection'`. Result: apply present, crop present, **flatten ABSENT**, remove present. Expected: present beside Crop.
- **Known?** Not found in `docs/audits/**/LEDGER.md`, the 2026-10-16 register or the T16/T17/T18 reports.
- **Suggested fix.** Add `'tools.flatten-image-mask'` after `'tools.crop-image'` in `SELECTION_MORE_COMMANDS`.

Related note, not raised separately: the store comment "Shift+click toggle; never clears the primary" (`store.ts`) undersells the behaviour. Shift-click can **replace** the primary with an earlier object in scene order (R3). This is the root mechanism of T18-P2-1, and it affects every primary-only command, such as Trace and Adjust Image. The coordinator may want the fix for T18-P2-1 to resolve the masked raster from the whole selection, as the auditor suggests, rather than change selection ordering globally.

## Totals
- Verdicts: 1 confirmed (T18-P2-1, P2; also covers Remove Image Mask). Refuted 0; severity changed 0.
- Extra findings: raised 1; P1 0; P2 0; P3 1 (T18R-P3-1).
