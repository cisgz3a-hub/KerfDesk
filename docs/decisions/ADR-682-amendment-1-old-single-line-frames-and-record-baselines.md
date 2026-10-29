## ADR-682 Amendment 1 - Old single-line frames keep their line rule, and boxed records share the template's baseline at any size (2026-10-29)

**Status:** Accepted; tested against emitted G-code from a schema-18 project that the parent of
#1507 built and saved. Not hardware-tested. | **Date:** 2026-10-29

Amends Decision 4 and Decision 6 and the frame bullet of the Consequences. Fixes rolling audit v8
N4-P1-1 (P1, a regression from #1507) and N4-P2-1 (P2), and settles N4-P3-3
(`docs/audits/2026-10-29-rolling-v8/N4-fix-text.md`). The Frame-first Start contract (PROJECT.md
non-negotiable 21, ADR-565) is unchanged, and nothing here adds or removes a Start guard.

### Context

- **Old frames refit smaller.** Decision 4 promised that schema 19 keeps old single-line text
  exactly as drawn. It converted Size, line height, letter spacing and the frame's smallest size,
  but not the frame's line rule.
  - A frame counts its last line as a fixed number of ems times Size (`text-box-layout.ts`). Before
    #1507 a single-line frame counted one cap-height Size. After it, the frame counts one em, so a
    converted Size (×1000/680 for Relief, ×2 for the EMS fonts) made each line count 1.47 or 2 times
    taller.
  - A fixed shrink-to-fit frame that fitted therefore shrank its text on any re-render: variable
    records at every output, and plain framed text at its next edit.
  - Example: a 1.0.27 Relief name tag, `{{csv:name}}` at Size 10 in an 80 × 11 mm frame, burned
    "ANNA" 39.588 × 10.000 mm. After the upgrade it burned 29.612 × 7.480 mm. A plain Relief "ANNA"
    in an 80 × 10 frame re-rendered at 26.920 × 6.800.
  - Nothing warned, and the canvas kept drawing the stored template.
- **1.0.28 shipped #1507** on 2026-10-29. Schema-19 files written under the em rule already exist,
  so changing the single-line rule for every frame would refit those instead.
- **Narrow frames still split baselines.** Decision 6 moved a boxed record to the template's
  baseline only when both laid out at the same size.
  - In a 40 or 50 mm name tag the literal `{{csv:name}}` shrinks to fit, while the names fit at
    full size, so no record matched the template's size.
  - Al, Anna, anna and Peggy burned on baselines 342.500, 342.793, 344.521 and 340.757: the 2.02
    mm spread Decision 6 set out to remove.
- **Tall records cross the frame top (N4-P3-3).** A record taller than the template's braces rises
  above the frame top when it moves to their baseline: Roboto "Ågot" by 1.66 mm at Size 10. The
  frame's overflow flag looked only at the bottom.

### Decision

1. **A converted frame keeps its line rule.** `TextBoxSettings` gains an optional `legacyLineEm`.
   - Step 18 (to schema 19) sets it on every single-line text frame it converts: 0.68 for Relief
     and 0.5 for the EMS fonts. That is the old cap-height Size in ems.
   - The single-line layout counts a line as that many ems instead of one. Size is multiplied and
     line height divided by the same factor, so every comparison the frame makes is the old one.
     An old text lays out, shrinks and burns exactly as before.
   - New frames have no `legacyLineEm` and keep the em rule. So does every frame in a schema-19
     file: the file does not record which text step 18 converted. A file that 1.0.28 converted and
     saved therefore keeps the em rule, and that cannot be undone.
   - The rule stays with the frame through edits, including a change of font. Outline fonts ignore
     it. Turning the frame off and on again drops it.
   - **Rejected: scale the frame's height.** The old and new rules differ by a term that grows with
     the trial size, so no fixed height reproduces the old fit.
   - **Rejected: count single-line lines as cap heights for all text.** That would refit every
     frame 1.0.28 saved, and the EMS fonts' 0.5 is a placeholder that their capitals (up to 0.91
     em) exceed.
2. **Project schema 20.** A schema-19 reader ignores `legacyLineEm` and would fit converted text up
   to half as large when it is edited or a variable value changes, so it refuses schema 20. Step
   19 changes nothing else.
3. **A boxed record sits on the template's first baseline, scaled to its own size.** This replaces
   the first two bullets of Decision 6.
   - Records the frame gives one size share a baseline, whatever size the template took. In 40, 50
     and 80 mm frames Al, Anna, anna and Peggy share one baseline; only the bowl of the a dips 0.1
     mm below it.
   - A record whose ink fills the frame's height cannot move without leaving the frame. It keeps
     the frame's rule: ink top at the frame top.
   - That is common in converted frames, which count only the capital height. In the fixture's
     Relief tag, Maximilian, Peggy and Ågot fill the 11 mm frame and burn where 1.0.27 burned them.
     ANNA, Anna and Hello move to one baseline, 0.5 mm below where ANNA used to stand.
4. **A record taller than the template keeps the baseline and rises above the frame top; the frame
   says so** (N4-P3-3).
   - Its layout reports overflow at the top as well as the bottom.
   - The rows preview now lays out each row on the template's baseline, so such a row reads
     "Overflow".
   - **Not clamped under the frame top.** In 12 of the 24 bundled fonts measured (all but Tinos
     Bold), an ordinary ascender or capital stands taller than `{`. They include Relief, Pacifico and most of the scripts; Relief's
     l is 7.45 mm against 7.14 mm braces at Size 10. Holding such records under the frame top would
     put "Al" and "Anna" on different baselines again, which is the defect this decision removes.

### Consequences

- Old single-line projects burn at the sizes they burned in 1.0.27, at every output and after any
  edit.
- Records in old frames now share a baseline, as Decision 6 intended. A record that stood flush with
  the frame top may sit lower, or rise above it by its height over the braces: Hello's l passes the
  11 mm Relief tag by 0.46 mm.
- An accented capital passes the frame top by its height over the braces (Roboto Å: 1.66 mm at
  Size 10). The frame itself is never burned, and the rows preview flags the row.
- KerfDesk 1.0.28 cannot open a project this build saves.

### Verification

- `src/ui/text/single-line-frame-migration.test.ts` opens
  `src/__fixtures__/parent-saved-single-line-text-frames.lf2.gz`.
  - The fixture is a schema-18 project that the parent of #1507 (`0fcbe8e99`) built and saved
    through its own `buildTextObject` and `serializeProject`.
  - It holds Relief and EMS Casual Hand name tags with six CSV records, a plain Relief frame, two
    lines of EMS Nixish in a frame, and an auto-height frame.
  - Each text rebuilds to its stored geometry within 1e-9 mm.
  - Each record burns at the size the parent build's own G-code measured: ANNA 39.588 × 10.000 mm.
  - The record placement matches item 3.
  - With #1507's line rule the size checks fail: ANNA burns 29.612 mm wide.
- `src/ui/text/variable-text-placement.test.ts` runs boxed records in 40, 50 and 80 mm frames, plus
  "Ågot". On Decision 6's same-size rule, the 40 and 50 mm frames and the Ågot check fail.
- `src/ui/text/VariableRowsPreview.test.tsx`: a row lifted over the frame top reads "Overflow".
- `src/io/project/migrate-v18-single-line-text-em.test.ts`: a converted frame gets its line rule,
  and a schema-19 file opens unchanged.
