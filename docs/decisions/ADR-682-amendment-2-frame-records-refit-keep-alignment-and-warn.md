## ADR-682 Amendment 2 - A boxed record refits rather than leaves its frame, Auto width records keep the alignment, and an overflow warns at output (2026-11-02)

**Status:** Accepted; tested against emitted G-code, including a project the real 1.0.28
(`33bc394c6`) built and saved. Not hardware-tested. | **Date:** 2026-11-02

Amends Amendment 1 Decision 3. Fixes rolling audit v9 R4-P1-1 (P1, a regression from #1523), R4-P1-2
(P1) and R4-P2-1 (P2) (`docs/audits/2026-11-02-rolling-v9/R4-fix-text-frames.md`). The Frame-first
Start contract (PROJECT.md non-negotiable 21, ADR-565) is unchanged, and nothing here adds or removes
a Start guard.

### Context

- **The shared baseline could carry a record out of its frame.** Amendment 1 Decision 3 moves a
  record to the template's baseline unless its ink fills the frame. It checked nothing else.
  - EMS Casual Hand's braces stand very tall, so the baseline of a `{{csv:name}}` template sits low.
    In an 80 × 11 shrink-to-fit frame, the template's baseline scaled to Size 10 is 10.552 mm down,
    which leaves 0.448 mm for a 4 mm descender.
  - "Gypsy" fits the frame at Size 10, 10.68 mm tall. 1.0.28 burned it at Y 339.320..350.000, inside
    the frame. Amendment 1 burned the same file at 335.448..346.128, 3.552 mm below it, with no
    warning.
- **Auto width records ignored the alignment.** The renderer returned the text's own transform for
  every framed record, so output's anchor step never ran. An Auto width frame is each record's own
  width, so its left edge is not a shared place: a centred "Al" burned 23.63 mm left of the template's
  centre, and a right-aligned one 47.26 mm left of its right edge.
- **Only the rows preview read the overflow flag.** A record could burn 33.3 mm below a 10 mm frame,
  or 64.5 mm past a 30 mm width, with nothing at Start or Save.

### Decision

1. **A shrink-to-fit record the baseline would carry past the frame bottom shrinks until it fits on
   that baseline** (`onTextBoxBaseline`).
   - Baseline and ink both scale with the record, so the bottom scales linearly from the frame top:
     the scale is the frame height over the moved bottom. Gypsy refits to Size 7.56, and its ink bottom
     sits on the frame bottom.
   - The record scales about the frame's alignment point, so it stays left, centred or right.
   - The frame's smallest size still holds. A record that would need less stops there and overflows.
   - A frame that is not shrink-to-fit never changes a record's size. Its record moves and warns.
   - **"The shared baseline" means the template's baseline scaled to the record's own size**, as
     Amendment 1 defines it. Records the frame gives one size share one line in the burn. A refit
     record has a smaller size, so its baseline sits higher: in the example about 2.58 mm above
     Anna's (calculated), Gypsy at Size 7.56 against Anna at Size 10. No readable size can do better.
     Keeping Anna's baseline in the burn would leave Gypsy's descender 0.448 mm, which is Size 1.12.
   - **Rejected: clamp the record inside the frame at its own size.** It keeps Size 10 and puts
     Gypsy's baseline 3.552 mm above Anna's, the split N4-P2-1 removed, with no shrink to show why.
     The audit's refuter pointed this out.
   - **Rejected: let the record out and only warn.** A record that fits should not leave its frame
     because of the app's own move, and 1.0.28 burned it inside.
2. **The top keeps Amendment 1 Decision 4.** A record taller than the template's braces still rises
   over the frame top. Refitting cannot cure that: its ink and the baseline scale together, so it
   passes the top at any size.
3. **A record that already fills the frame keeps the frame's rule,** as Amendment 1 says. Its size
   and place do not change. So a record just short of filling refits and one that fills does not; the
   frame's rule has that step, and Peggy and Gypsy in the example differ by it.
4. **Auto width records keep the template's alignment point.** The renderer gives no fixed transform
   for that mode, so output's `anchoredVariableTextTransform` moves each record's alignment point to
   where the placed template's was, as it does for unframed text. Its cache key now includes the
   frame.
5. **A record past its frame warns at output.** `renderVariableText` reports how far the ink passes
   the edges the user typed (`textBoxOverflowMm`): all four of a fixed frame, the sides of an Auto
   height frame, none of an Auto width frame.
   - A new `variable-text-overflow` advisory reaches Job Review, Start, Save G-code, .rd, tiled
     G-code, the artwork exports, print and Bake: "Variable text “Maximilian Alexander” (CSV record 1):
     overflows its frame by 33.3 mm. It still burns in full."
   - It covers a rise over the frame top, so Amendment 1 Decision 4's "the frame says so" now reaches
     output.
   - Under 0.05 mm is no wider than the beam and stays quiet. Distance is in the millimetres the
     object burns at.
   - It never refuses output and adds no Start guard. Several records share one toast (ADR-591
     Amendment 3).
   - The rows preview's flag uses the same edges, so an Auto height record it moved no longer reads
     "Overflow".

### Consequences

- Casual Hand tags burn inside their frames, as in 1.0.28. Names with descenders that leave the frame
  now burn smaller and higher than the names beside them. Only EMS Casual Hand crossed by more than
  0.05 mm in the audit's sweep of 25 fonts.
- A name that needs the refit changes size against 1.0.28 and against Amendment 1, with no warning: it
  fits, and Shrink to fit is what the frame asked for. The rows preview shows the size.
- Projects with a font whose ascenders pass the braces now warn for those records at Start and Save,
  by the small distance they always rose (Relief "Hello" 0.46 mm). They share one toast.
- Auto width records burn in a different place than every earlier build, on the template's alignment
  point.

### Limits

- A refit scales the laid-out record. It does not wrap it again at the smaller size.
- Bake and a production row turn a record into plain text. Bake warns as it does so, and its overflow
  stays visible on the canvas. A production row's overflow is not named at open, capture, or that
  row's later Start.
- More than three preflight findings can still push each other out of Save's toast list (ADR-591
  Amendment 3).

### Verification

- `src/ui/text/variable-text-frame-older-project.test.ts` opens
  `src/__fixtures__/release-1-0-28-casual-hand-frame.lf2.gz`, schema 19, built and saved by 1.0.28's
  own `buildTextObject` and `prepareProjectForPersistence`. Each record stays inside the frame with
  no warning and centred where that release's own G-code centred it; Anna and Al keep the size it
  burned.
- `src/ui/text/variable-text-frame-output.test.ts` reads emitted G-code: refit, alignments, two
  lines, no-fit and smallest-size frames, Auto width at each alignment on outline and single-line
  fonts, on two lines and turned; fixed, wrapped and Auto height, bent and path records as controls;
  the advisory at Start, Save, .rd and tiled G-code.
- `src/core/text/text-box-render.test.ts`: the refit's scale, its alignment point, the size floor and
  a no-fit frame.
- `src/ui/text/single-line-frame-migration.test.ts`: every schema-18 size and placement Amendment 1
  fixed still holds, unchanged.
- The frame has no vertical alignment setting (`TextBoxSettings`), so there is none to test.
