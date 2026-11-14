## ADR-410 Amendment 6 - Offset Shapes names its result operation and the shapes it loses (2026-11-14)

**Status:** Accepted. | **Date:** 2026-11-14

### Context

Tools audit T1 (`docs/audits/2026-11-13-tools-t1/LEDGER.md`) checked Offset Shapes
(`tools.offset-shapes`) on main eeac725e8 and found three P2 defects. A refuter upheld all three,
narrowing the first. Each one was checked by decoding the G-code from the real `prepareOutput` and
emitter.

- **T33-P2-1: the result's operation was chosen silently.** Item 3 offsets the selection "as one
  design", and its result gets "their own operation cloned from the first source". That source
  was the first one in scene order. The dialog did not show that operation, so the result could
  land on any of them:
  - A guide drawn first on an output-off operation, offset with a part and Delete original
    objects on: the burn fell from 60 mm to 0 mm.
  - The part drawn first: the guide's ring was cut at 95 % (378 mm instead of 66).
  - A cut outline drawn after a Fill shape: its offset was hatched (2,000 mm of fill became
    6,330 mm).

  Union Silhouette already asks for this choice (ADR-350 item 2: "The operator chooses one
  selected operation for the result").
- **T33-P2-2: Inward with Delete original objects deleted shapes that made no ring, without a
  notice.** At 1.5 mm, a plate plus a 2.5 mm square burned 150 mm before and 128 mm after. A plate
  plus a 2 × 40 mm bar went from 224 to 128 mm, and a plate plus a 25 mm open line from 165 to
  128 mm. Item 3 has a notice only for a whole collapse under Both. The preview draws every
  source the same faint grey.
- **T33R-P2-1: the art's offset never burned in a jig left in Outline only.** New jigs start in
  Outline only (ADR-057), where the art's operation has output off. The clone copied that output
  setting. Artwork only turns back on only the operations in the snapshot that Outline only took,
  and the clone was not in it. So the ring burned in neither run: the Artwork only burn stayed at
  160 mm. The panel's Offset outlines (ADR-103) had the same gap.

LightBurn's Offset Shapes page does not say which layer the results go on, and it deletes every
selected object under Delete original objects. Splitting the offset per source operation would
undo item 3's single design, because overlapping shapes on different operations would stop
merging.

### Decision

1. **The dialog shows and lets the operator pick the result operation.** A **Result operation**
   list offers the operations the sources use, in operation-list order. Each is shown as "name
   (mode)", with ", output off" added when it will not burn. All rings still go on one copy of
   the chosen operation, so the union of item 3 is unchanged. `OffsetShapesRequest.operationId`
   carries the choice. An id that is not one of the sources' operations falls back to the default.
   The dialog does not remember the choice between selections.
2. **The default operation.** The default is the primary selection's operation when it burns.
   Otherwise it is the first of the sources' operations that burns, and if none burns, the primary
   selection's operation. A registration jig's outline operation is never the default.
3. **An operation that will not burn is called out.** The dialog shows an alert, and Apply raises
   a warning toast that names the operation. This replaces "cloned from the first source" in
   item 3.
4. **Shapes that get no inward ring are named.** For Inward and Both, a source has made no ring of
   its own when no inward ring lies within the offset distance of its closed outline. The check
   adds 1 % of the distance plus 0.05 mm of slack for arc and curve tolerance. A collapsed shape
   and an open line both fail it. The check lives in `sourcesWithoutInwardOffset`
   (`src/core/geometry/offset-shapes-coverage.ts`).
   - The dialog lists those shapes (first three by name, then a count) in an alert before Apply,
     and Apply repeats the list as a warning toast.
   - With Delete original objects, the notice says the shapes are removed with nothing in their
     place, and that Undo brings them back. Under Both it says they keep only the outward
     offset.
   - Delete original objects still deletes them, as LightBurn does.
   - A whole collapse under Both keeps its existing notice.
5. **A clone of jig artwork restores like its source.** While a jig's Outline only snapshot
   exists, each operation that Offset Shapes or the panel's Offset outlines clones is added to the
   snapshot with its source's value. Artwork only then turns the offset on with the art.
   `prepareIndependentArtwork` moved to `src/ui/state/independent-artwork.ts`, with
   `prepareIndependentArtworkOn` for a chosen operation.
6. **Name and size (T33-P3-2, T33-P3-4).** When one named shape is offset, the result is named
   "<name> offset" or "<name> inward offset". The status line adds "The outward offset is larger
   than the W × H mm bed." when the outward result does not fit the project's bed. Any distance is
   still accepted.

### Alternatives

- **One offset per source operation.** Rejected: overlapping shapes on different operations would
  stop merging, which item 3 forbids, and the refuter found the same.
- **Refuse Apply when the operation has output off.** Rejected: putting a guide offset on a guide
  operation is legitimate. A warning names the case without blocking it.
- **Keep the shapes that make no ring.** Rejected: it would change what Delete original objects
  means and would differ from LightBurn. The notice makes the loss visible, and Undo restores it.
- **Compute rings per source to find the losses.** Rejected: it costs one more offset per source.
  The distance test reads the result the action already has.

### Consequences

- Offsetting a mixed selection now defaults to the operation of the shape the operator clicked
  first, not scene order. A selection whose primary shape is on an output-off operation now
  defaults to a burning one.
- The dialog has one more row, and up to two alerts.
- Not changed: distance 0 is still refused (T33-P3-1), which stays open as a P3. LightBurn's
  repair use of 0 needs its own design: Both at 0 would add two copies of the same outline.

### Verification

- `src/ui/state/offset-shapes-result-operation.test.ts`: decoded G-code for every repro above
  (the guide, scene order, Fill hatching, the three Inward losses and a partial Both, and the jig
  through Offset Shapes and the panel offset). It also covers the single-part control and the
  result name.
- `src/ui/commands/OffsetShapesDialogOperation.test.tsx`: the picker's options and default, the
  output-off alert, the operation the result gets, the collapse alert before Apply, and the bed
  hint.
