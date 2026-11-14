## ADR-570 Amendment 2 - A stamp's source artwork stays, with Output off (2026-11-14)

**Status:** Accepted. Tools audit T1 finding T32-P1-1 and the P3s found with it. | **Date:** 2026-11-14

### Context

ADR-570 says stamp preparation "preserves source artwork". Tools audit T1
(`docs/audits/2026-11-13-tools-t1/`, T32) confirmed on main eeac725e8 that it also left that
artwork burning:

- **T32-P1-1 (P1).** Apply added the stamp on a new Image operation and left the source on its own
  operation with Output on. The stamp recesses everything except the raised face, and the source
  burns exactly that face. On the obvious journey (select art, Prepare Stamp, Apply, Start) the
  decoded G-code burned 53.8 % of the face for an asymmetric photo with Mirror on (the default),
  46 % for "KERF" text on a Fill, and 95-100 % with Mirror off or symmetric art. With the source
  operation set to Output off the face got 0 mm.
- Nothing said so. There was no toast, and Job Review's `stackedCopyWarnings` matches only
  identical copies. The canvas draws the opaque stamp over its source, so only the optional
  Preview showed the doubled burn.
- **T32-P3-1.** The stamp image and its operation used Floyd-Steinberg, so a stamp with 1,916 grey
  shoulder pixels burned at one power (S300): the shoulder became full-power dots, not the slope
  the height map shows.
- **Rolling v3 H5-P3-3.** The stamp operation took the photo's import-time `linesPerMm` (10), not
  the 25 lines/mm its Image operation burns at.
- **T32-P3-2 and T32-P3-3.** The menu item was enabled for any selection, including an open path
  the tool then refused, and WORKFLOW.md never mentioned Prepare Stamp.

Trace is the keep-the-source precedent: it keeps the photo burning, says "source kept" in its
toast, and WORKFLOW F-E1 tells the user to delete the source or turn its Output off. A traced
outline and its photo can both be wanted in a job. A stamp and its source never can: whatever the
source burns is the raised face. LightBurn has no Prepare Stamp; its stamp workflow burns one
object, the artwork itself.

### Decision

1. **Apply keeps the source objects and turns their output off**, in the same Undo step as adding
   the stamp. An operation only the sources use has Output turned off. An operation other artwork
   also uses is copied once, as "<name> (stamp source)" with Output off, and the sources move to the
   copy, so the other artwork keeps burning
   (`withObjectsOutputOff`, `src/core/scene/reference-image-output.ts`, which Trace from Camera's
   `withImageOutputOff` now calls). Objects, groups, pixels and settings keep their identities; the
   user can turn Output back on in Cuts / Layers. One Undo restores the project exactly.
2. **Apply says so.** The toast reads 'Stamp added on "Stamp height intent", source kept with
   Output off so it cannot burn the raised face. Undo brings it back.', in line with Trace's
   "source kept". The dialog's Apply paragraph says the same before Apply.
3. **The stamp burns as Grayscale.** The stamp image and its operation use the Grayscale dither,
   so each pixel's power follows its height: the white face burns at 0 and the shoulder slopes.
   The dialog names 3D Sliced (ADR-699) as the alternative for burning it as depth slices. Power
   is still the user's ordinary operation setting; ADR-570's "does not infer laser power" stands.
4. **A photo's stamp burns at its operation's lines/mm.** For a single raster source on an Image
   operation, the stamp operation takes that operation's effective `linesPerMm`
   (`effectiveOperationForObject`, as the rasterized trace does). A vector stamp keeps the
   dialog's DPI.
5. **The menu item is enabled only for a selection the tool accepts**: one raster image, or closed
   vector artwork only, with variable data left out (ADR-350 Amendment 3). The command context's
   `canPrepareStamp` and the dialog's checks read the same `stampSourceSelection`.
6. WORKFLOW.md gains F-A7e3 for Prepare Stamp, and F-A7e2 (Fill Ramp) points to it.

### Not covered

Job Review still has no general overlap warning for different artwork stacked at one place; with
the source's output off a stamp no longer needs one. A stamp prepared and exported as PNG only
changes nothing in the project, as before.

### Verification

`src/ui/state/stamp-source-output.test.ts` decodes the job's G-code and measures the lit length
on a per-cell face mask computed from the source pixels, not the tool's mask: a photo with Mirror
on and off, and a vector ring sharing a Fill with other artwork (which must still burn). It also
checks the copied operation, exact Undo, the Grayscale levels in the emitted S values, and
25 lines/mm. The face, Grayscale and lines/mm tests fail on main 53393cc16.
