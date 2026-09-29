## ADR-307 Amendment 1 - Array copies are limited only by the project, and a request it cannot hold is refused (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

### Context

ADR-307 decision 5 removed the 500-copy policy cap from Array and put nothing in its place, and
ADR-499 added the grid and circular extras and the dialog's status line. Array then had no bound of
any kind (the 2026-09-28 weakness audit, found while fixing H-5, ADR-498 amendment 1):

- **A request could make a project that cannot be opened again.** The project file loader refuses
  a scene of more than `PROJECT_SCENE_LIMITS.objects` (10,000) objects (`validateSceneBudgets`,
  called from `project-shape-validator.ts`), and the registration jig editor (ADR-316 item 3), the
  SVG fragment insert and the personal-artwork insert keep to the same figure. An array of 10,002
  instances saved as a 6 MB file, and opening it said "invalid `scene.objects`: count 10002
  exceeds 10000". That is lost work, and it is a fact about the file format, not a policy about
  what is sensible to cut.
- **A count too large for an array reached the layout.** A grid of a million by a million looped
  a trillion times, growing a list of placements until memory ran out (under a 1 GB heap the test
  worker died of a JavaScript heap overflow in about twenty seconds). A circular or point rotation
  array of 1e12 threw `Invalid array length` out of the store action, uncaught.
- **Variable copies rendered every copy first.** With Advance variables on, one render per copy
  was awaited for the whole count before any copy was placed.
- **Find pieces reported success it had not had.** Place selection on each piece shares the store
  action (ADR-442) and said "Placed on N pieces" whether or not anything was placed.
- **Other commands that add objects in one step had the same hole.** Duplicate made a project of
  6,000 selected objects into 12,000, and the saved file reopened as "invalid `scene.objects`:
  count 12000 exceeds 10000". Paste and Paste in Place did the same from a clipboard of 6,000,
  and a paste from another project brought its operations with it: 200 copied into a project of
  100 made 300, past the loader's 256 ("invalid `scene.layers`"). Break Apart made one imported
  artwork of 12,000 strokes (a stipple, a sheet of parts) into 12,000 objects. Cut Shapes adds a
  piece for every shape it crosses: three shapes cut in a project of 9,999 objects made 10,001.
  Array on board (ADR-125) tiles one design up to 500 times across a placed board: filling a
  300 mm board with a 10 by 5 mm design in a project of 9,702 objects made 10,166.

ADR-307 decision 5 says every valid requested placement is materialized. This amendment says what
valid means: one the project can hold. It is not the policy cap decision 5 removed, because the
figure is the loader's and not a judgement, and every request that fits is still placed in full.

### Decision

1. **One limit: the project's own.** A copy is the selection and everything it carries with it (an
   image's mask, a path text's guide: `sceneObjectCopyClosure`). The original moves to the first
   placement and is not a copy, and the object a circle is centred on (ADR-499 item 2) is neither
   copied nor moved, so it is not counted. The project has room for `floor((10,000 - objects in
   the project) / objects per copy)` more copies, and every request up to that many, with the
   original, is placed in one undo step. A request for more is refused, never clamped, and nothing
   changes. The message says how many fit and what to change: "This project has room for at most
   18 more copies of this selection (project limit 10000 objects). Use fewer rows or columns."
   (Grid; "Use fewer copies." for Circular and Point Rotation, "Untick some pieces." for Find
   pieces.) A project with no room at all says so and to delete some objects. An array of one
   instance adds nothing, so it always fits.
2. **The count is compared with the room before anything is laid out.** `arrayPlacementCount`
   (`src/core/scene/array-layout.ts`) gives the number of instances from the same rounding the
   layouts use, so 1e12 and 1e300 are refused as too many exactly as 10,001 is. A count that is
   not finite or is below 1 still reads as 1, and a fraction rounds down, as before.
3. **The dialog says so, and Apply is off.** The status line shows the message in place of the
   summary, Create array is disabled, and Enter does nothing, so the store is not asked. The
   request is counted from the numbers alone, without laying any copy out, so typing 1e300 costs
   what typing 4 costs. With Advance variables on, the same check runs before the first render
   (`prepareVariableArray`), not after one for each copy.
4. **The room counts objects; the scene is then checked exactly.** Two things make the object
   count alone inexact at the edge. The first placement copies rather than moves whatever another
   object depends on, whatever sits on the edge of a group, and locked objects the selection
   needs (`planArrayFirstPlacement`), which adds objects the room did not count. And a saved file
   can nest or overlap groups, so a copy's groups or group members reach their limits (10,000
   groups, 50,000 members) before its objects reach 10,000. So after the copies are built, the
   scene is refused if any of the objects, groups or group members counts both passes its limit
   and is larger than it was: "This would take the project past its limit of 50000 group members.
   Ask for fewer copies, or delete some objects first." A project that is already over a limit
   still moves things about, because an array that adds nothing grows nothing.
5. **Everything that copies the selection shares one working.** `scene-copy-room.ts` holds the
   room (`copiesThatFit`, `sceneCopyRoom`, which lets originals that are not kept give their
   places back), the two messages and the exact check (`sceneLimitOverrun`). Copy Along Path
   (ADR-498 amendment 1) now uses it instead of a working of its own, and gets the exact check for
   groups too. Find pieces (`placeSelectionCopies`) reports whether it placed anything, and its
   panel says "Nothing was placed" when it did not, instead of "Placed on N pieces".
6. **No small cap, and nothing is clamped.** A request that fits is placed whole. The largest a
   project can hold, one object made into 10,000, was applied in about a quarter of a second in
   the test run, saved, and opened again.
7. **Every command that adds objects in one step keeps to the same limits.** Such a command
   builds the scene it would make and holds it to the exact check of item 4
   (`refuseSceneLimitOverrun`, which shows `sceneLimitOverrun`'s message as a warning notice). A
   result that would take a count past its limit, and grow it, is refused whole and nothing
   changes: no undo step, no change to the selection, and never a part of it made. Everything that
   fits is made exactly as before. The notice names the limit and says what to change in the
   command's own words:
   - **Duplicate:** "This would take the project past its limit of 10000 objects. Duplicate fewer
     objects, or delete some objects first."
   - **Paste and Paste in Place:** "... Copy fewer objects to paste, or delete some objects
     first." The clipboard is kept, to paste once there is room.
   - **Break Apart:** "... Break apart fewer objects, or delete some objects first." A group
     takes all of an artwork's parts in the artwork's place, so its members are held to their
     limit too. A refused Break Apart lets go of no image mask, so it says nothing about masks.
   - **Cut Shapes:** "... Cut fewer shapes, or delete some objects first." A refused cut does not
     say how many pieces it made.
   - **Array on board:** "... Array fewer copies on the board, or delete some objects first." Its
     own bound of 100 tiles a side and 500 in all is unchanged.

   These commands add what the selection or the clipboard makes, and Array on board lays out at
   most 500 tiles, so the scene each would make is cheap to build and is checked as it is: no
   room is worked out in advance. No cap below the loader's limits is added, and a project that
   is already over one stays free to change in ways that add nothing to it. The exact check now
   holds the fourth count the loader does, operations (256), as well as objects, groups and group
   members, because a paste from another project brings its operations with it. Array and Copy
   Along Path add no operations, so nothing changes for them.

### Alternatives

- **A small fixed cap (500, 1,000).** Rejected: it is the policy cap decision 5 removed.
- **Clamp to the room.** Rejected: the operator asked for a number of copies, and a different
  number placed silently is the truncation decision 5 removed. A refusal that names the number
  that fits lets them choose.
- **Warn, then place anyway.** Rejected: the result could not be opened again.
- **Check in the dialog only.** Rejected: Find pieces, variable copies and any direct call reach
  the store action without the dialog, and a dialog can be stale by the time Create array is
  pressed.
- **Count the first placement's extra copies in the room.** Rejected: they depend on where the
  first copy lands, which needs the placements laid out. The exact check covers them, and they
  matter only within a few objects of the limit.
- **One gate on every change to the project, instead of a check in each command (item 7).**
  Rejected: it would see every write to the project, undo and redo included, so it could refuse
  something other than a command adding objects, and its notice could not say what to change in
  the command's own words. Each command asks the one shared check instead, so the counting is
  still in one place and nothing else can be refused by it.

### Consequences

- Array never takes a project over the limit it can be reopened with. A project that is already
  over it (Array could make one until now) gets "no room" until objects are deleted.
- Applying a large array still costs what its copies cost, and no more. Typing one costs nothing.
- Duplicate, Paste, Break Apart, Cut Shapes and Array on board keep to the same limits (item 7).
  Design Studio Apply does not check them yet.
- No schema change and no change to G-code.

### Verification

- `src/core/scene/array-layout.test.ts`: the count equals the length `arrayPlacements` returns for
  every mode, including malformed input, and answers 1e12, 1e300 and Infinity without allocating.
- `src/ui/state/array-limits.test.ts`: a million by a million grid, a grid past the largest number,
  a circle of a trillion and a point rotation of 1e300 place nothing and say what fits; exactly the
  room, and one more, for each mode; masks, several selected objects and a circle's centre object
  counted correctly; no room at all; explicit placements refused with the pieces wording; 10,000
  instances placed in one undo step and saved and reopened; group members past their limit
  refused though the objects fit; the first placement's extra copy refused at the limit; a project
  already over the limit still moves things.
- `src/ui/state/scene-copy-room.test.ts`: the room, the messages, the command's own words, and the
  exact check against the loader's own `validateSceneBudgets`, operations included.
- `src/ui/state/prepare-variable-array-limits.test.ts`: no render for a refused request, exactly
  the room prepared and applied, absurd counts refused.
- `src/ui/commands/ArrayDialogHost.limits.test.tsx`: the status line and Create array for all
  three modes, the centre object, absurd counts and no room.
- `src/ui/camera/pieces/PiecesControl.test.tsx`: "Nothing was placed" with the reason in a notice.
- `src/ui/state/copy-along-path-group-limits.test.ts`: Copy Along Path refuses group members past
  their limit.
- `src/ui/state/duplicate-limits.test.ts`: 6,000 selected objects are not made into 12,000 (they
  were before, and the file did not reopen); 5,000 duplicated to exactly 10,000 in one undo step,
  saved and reopened; an image's mask counted, to the last object; group members past their limit
  refused though the objects fit, and exactly 50,000 accepted; a project already over the limit
  not grown.
- `src/ui/state/paste-limits.test.ts`: Paste and Paste in Place of 6,000 into 6,000 refused with
  the clipboard kept; 5,000 into 5,000 pasted in one undo step and reopened; one object past the
  limit refused; 200 operations from another project refused in a project of 100 and pasted, to
  exactly 256, in a project of 56.
- `src/ui/state/break-apart-limits.test.ts`: one artwork of 12,000 shapes is not made into
  12,000 objects (it was before); 11 shapes broken apart to exactly 10,000 objects in one undo
  step and reopened, and 12 refused; group members past their limit refused though the objects
  fit, and exactly 50,000 accepted; a refused Break Apart of an image's mask says nothing about
  the mask.
- `src/ui/state/cut-shapes-limits.test.ts`: a cut that would make 10,001 objects is refused with
  the refusal alone for a notice (it was made before); one that makes exactly 10,000 is made in
  one undo step, says so, and reopens.
- `src/ui/state/board-tile-limits.test.ts`: filling a board with 465 tiles in a project of 9,702
  objects is refused (it was made before); a 2 by 2 array one object past the limit refused, and
  one to exactly 10,000 made in one undo step and reopened.
