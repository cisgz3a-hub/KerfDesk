## ADR-711 - A Photo Test Card finds the power and speed for a photo (2026-11-13)

**Status:** Accepted; code, unit and browser evidence only. No material was engraved and no
controller was operated. Amends ADR-581 Decision 7 and ADR-685 Decision 2: the Photo engraving
window can now write power and speed, but only values the operator picked from a burned card.
It changes no G-code emitter, compiler, Frame gate, Start guard, licence rule or project schema. |
**Date:** 2026-11-13

### Context

The maintainer asked whether KerfDesk is fully built for a photo-realistic face on stone, and how
to make the right settings easier to reach than in any other software.

The photo's processing is built. A material recipe sets the marking, Blue Noise, Auto tones and a
light sharpen (ADR-685). Tone Calibration corrects how the material darkens (ADR-670). What the
operator still has to guess is **power and speed**, and a wrong guess makes a face a grey smudge
or leaves it barely visible.

- ADR-581 and ADR-685 refuse to invent power and speed, because they depend on the machine and
  the material. That is still right.
- Material Test (ADR-497) burns filled squares or cut outlines. A solid square says how dark full
  coverage gets. It does not show which power and speed make a dithered face look right.
- Starter presets exist for one machine and for wood, MDF, acrylic and paper. None covers stone.
- LightBurn's guide says to run a material test and an interval test, then adjust the image by
  hand. ImagR prepares the picture and never sees the machine. Neither burns the operator's own
  photo across a range of settings.

### Decision

1. **Tools → Calibrate → Photo Test Card...** opens a two-step dialog for the selected photo.
   **Burn a test card…** under a new **Power and speed** heading in Photo engraving first applies
   the window's settings to the photo (the ordinary Apply, one Undo step), then opens the dialog
   for it. The card replaces the project, so applying first means one Undo after the card returns
   to the photo with its recipe and tones in place, instead of losing them with the window. Like Tone Calibration it is not behind the dirty-project question: its first step asks
   before Generate replaces the project, and its second step keeps the project. With no photo
   selected and a card already generated on this computer, it opens at the second step.
2. **Burn the card.** Generate replaces the project (after the usual save question; one Undo
   brings the photo back) with a grid of squares. Every square burns the **same piece of the
   operator's own photo**. Power runs low to high across the columns and speed runs fast to slow
   down the rows, so the first square burned is the gentlest, as in Material Test. Both axes hold
   1 to 8 values. Labels for each column's power and each row's speed are burned beside the grid.
3. **A square is a window onto the final burn.** `core/job/photo-test-patch.ts` cuts the piece
   from the photo's stored pixels and keeps the photo's placed scale: a 15 mm square shows 15 mm of
   the photo as it is placed, not a shrunken copy. A mirrored photo's piece is mirrored the same
   way. Each square is an Image-mode raster on its row's operation. That operation copies the
   photo's effective operation (dither, interval, marking, passes, scan settings, dot width and
   any tone calibration), and each image carries the photo's brightness, contrast, gamma and
   sharpening. Only power and speed differ: the row's operation holds the speed, and each square
   overrides the power. Compiling the squares gives the same dots in every one
   (`photo-test-card.test.ts`).
4. **The piece.** The dialog shows the photo with the piece outlined. A click moves it, and two
   percentage fields do the same by keyboard. It starts at the middle across and 40% down, where a
   portrait's eyes usually sit. The square is 5 to 50 mm and shrinks to fit a smaller photo.
5. **Bounded size.** Every square stores its own copy of the piece, because the scene has no
   shared pixel store for generated images. Two rules keep a card small. Source pixels finer than
   two per burn cell are averaged in whole blocks, since the burn grid cannot hold more; the placed
   size is unchanged. The canvas copy is an 8-bit greyscale BMP (`encodeBmp8Grey`), a third of the
   24-bit size.
6. **Ranges.** Opened from a photo, the ranges are centred on the power and speed the photo burns
   with: half to one and a half times each, inside 100% power and the machine's top feed. They are
   a starting window, not a material recommendation. The rows, columns, square size, gap and piece
   position are remembered on this computer.
7. **Pick the best square.** The second step redraws the card's grid with the same powers and
   speeds, read from the last card generated on this computer. The operator clicks the square
   that looks best and names the material. A pick on the edge of the card says which way to move
   the range for another card, except that 100% power has nothing above it. Saving stores the
   power, the speed as the job ran it (capped at the top feed), and the dither, DPI and marking
   the card burned with (`localStorage`, newest first, 50 at most, a same-named one replaced).
8. **Choose it per photo.** Photo engraving's **Tested power and speed** lists the saved results.
   The first entry keeps the operation's own power and speed and names them. Apply writes the
   chosen power and speed into the photo's scoped operation override, in the same single Undo step
   as the rest of the window. The shared operation and other photos on it are untouched, and a
   sub-operation keeps its own settings. The photo's power multiplier returns to 100%, because the
   square burned at exactly the tested power. With nothing chosen, Apply writes neither field, and
   an earlier tested power and speed stay.
9. **Honest notes.** When the card was burned with a different dither, DPI or marking than the
   window now holds, the window says so. Tone Calibration's existing notice (ADR-670) already
   reports a calibration measured at another power or speed; it now compares against the tested
   ones when they are chosen, and **Calibrate a material…** seeds the wedge with them. The intended
   order is recipe, test card, then wedge.
10. The dialog and the card generator load on demand, as Photo engraving does. Only the small
    session store and its host load with the app, so the boot bundle budget is not spent on a
    calibration tool.
11. The window's guide and the image tutorial now point to the test card for power and speed. The
    tutorial no longer says a recipe sets the row density; it never did (ADR-685 Decision 2).

### Not decided here

- **DPI.** The card holds DPI fixed at the photo's. A "use this DPI" button from the spot size
  would change ADR-685 Decision 4 and is left for a separate decision.
- **Rotation.** A rotated photo's piece burns upright. The scan then crosses the picture in
  another direction than it will on the placed photo.
- **Masks.** The piece is cut from the stored pixels and ignores an image mask or clip, so a
  piece placed over a masked-out background burns that background.
- **Stone presets, camera-read cards and a soft edge** are separate work.

### Verification and limits

- `core/job/photo-test-card.test.ts`: the piece keeps the photo's scale and stays inside it, source
  detail beyond the burn grid is averaged without changing the placed size, a mirrored photo's
  piece is mirrored; power and speed order, every square burning with the photo's settings and
  tones, identical pixels and placed size, layout clear of the laser-off runway with burned labels
  and unique ids, a row capped at the machine's top feed, and identical compiled dots across all
  squares with each group at its own power and speed.
- `core/raster/encode-bmp.test.ts`: the greyscale BMP round-trips through the BMP decoder.
- `ui/calibration/photo-test-card-draft.test.ts`: seeded ranges and their limits, field messages,
  placed size and mirroring, the last card's round trip and refusal of damaged records, and the
  saved results list (order, replacement, reload, refusal of values that cannot burn).
- `ui/calibration/PhotoTestCardDialog.test.tsx`: the seeded card and its summary, the generated
  options and mirrored piece, clicking the photo, held Generate with a named field, no photo,
  unreadable or oversized pixels, the pick step with no card, saving a named pick, and the edge note.
- `ui/raster/photo-engraving-tested-burn.test.ts` and `PhotoEngravingDialog.tested-burn.test.tsx`:
  nothing chosen writes nothing, the chosen power and speed reach this photo alone in one Undo
  step, the multiplier is dropped only then, sub-passes keep their settings, invalid values are
  refused, the mismatch note, the wedge seed, and the card seed and Apply patch taken from the
  window's draft.
- `e2e/photo-test-card.e2e.ts`: in the browser, Burn a test card puts the slate recipe on the
  photo, Tools → Photo Test Card generates the card from it, the saved project holds six squares
  of the same piece at three powers and two speeds, a square is picked, and a photo then burns at
  that power and speed.

The card shows what the machine does to the operator's own photo, so it replaces no burn: the
operator must still burn it. No card was burned for this decision, on stone or anything else.
Heat build-up across a full-size photo, an uneven or curved rock, and focus are not on the card.
