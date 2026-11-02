## ADR-682 Amendment 3 - A frame 1.0.28 converted gets its line rule back, and an old project says what it burns differently (2026-11-02)

**Status:** Accepted; tested against emitted G-code from projects saved by the real 1.0.27 and 1.0.28
code. Not hardware-tested. | **Date:** 2026-11-02

Amends Amendment 1 Decision 1, whose "a file that 1.0.28 converted and saved therefore keeps the em
rule, and that cannot be undone" this replaces. Fixes rolling audit v9 R7-P1-1 (P1), R7-P2-1 and
R7-P2-2 (P2), and closes the test gap R7-P3-2 (`docs/audits/2026-11-02-rolling-v9/R7-returning-user.md`).
The Frame-first Start contract (PROJECT.md non-negotiable 21, ADR-565) is unchanged. Everything here
is a repair at load or a warning, and nothing adds or removes a Start guard.

### Context

- **Amendment 1 reaches only a direct open.** Step 18 sets `legacyLineEm`. 1.0.28 ran step 18 without
  that field and saved the result, so a schema-19 file arrives with no rule at all. A 1.0.27 Relief
  name tag saved through 1.0.28 burned "ANNA" 29.612 × 7.480 mm on main instead of 39.588 × 10.000,
  while the canvas drew the 11 mm template, and nothing warned. Across the audit's frames, the worst
  record shrank to 66.1 % and 14 records changed line breaks.
- **The file does record it.** Amendment 1 said it does not. A frame nobody edited on 1.0.28 still
  stores the geometry the old rule drew, and a frame made or edited on 1.0.28 stores what the em rule
  draws. The audit's refuter measured the comparison: 0 false fires on 360 frames and 61 fires on 72
  converted frames, each byte for byte with a direct open.
- **Intended changes reached old projects unannounced.** Variable records move (ADR-682 D5, D6 and
  Amendment 1 item 3): up to 38.6 mm in a bend, 1.7 mm on a path, 4.5 mm in a frame. Grayscale with
  Dot Width burns up to 66 % more dose (ADR-458 Amendment 1), and turned Pass-Through 38 % more
  (ADR-492 Amendment 1). Update notes are one file per release, so a user who skips 1.0.28 never reads
  those lines, and they never appear when the project opens.

### Decision

1. **Step 20 (project schema 21) gives the rule back when the stored geometry shows it**
   (`core/text/single-line-frame-rule.ts`, `io/project/migrate-v20-recover-frame-line-rule.ts`). For a
   single-line text in a fixed shrink frame with no `legacyLineEm`, it renders the text under both
   rules and compares them with what is stored.
   - Within 0.001 mm of the old rule's and not the em rule's: set `legacyLineEm`, exactly as step 18
     would have. Within that of the em rule's and not the old rule's: leave it.
   - **Ink that fills the frame's height** scales to one shape under both rules, so they match within
     any tolerance (Casual Hand 80 × 12). They still start from different trial sizes and part in
     their last digits. An EMS conversion doubles Size exactly, so the stored points of an unedited
     frame equal the old rule's render to the last bit, and that decides it. A Relief conversion multiplies by 1/0.68, so
     this never matches for Relief, which then falls under item 2.
   - Both schema 19 and schema 20 files get the check. Schema 20 was never released, but a build of
     main can have saved such a file.
   - **Schema 21 rather than a change to step 19,** so the check runs once for those files too and a
     saved file is settled. Nothing but `legacyLineEm` changes.
   - **Fonts at load.** `deserializeProject` is synchronous, so this imports the stroke font data
     statically. Those 199 KB stay in their own chunk, which now loads with the app rather than on the
     first single-line text. The parse and compile run only for a candidate frame in an older file.
2. **A variable frame the file cannot place stays on the em rule and warns.** Both rules can draw the
   template the same while records differ: Decorous 80 × 15 "ANNA" burns 47.46 × 10.27 mm under one and
   63.28 × 13.70 mm under the other. The warning names both.
   - **Not guessed.** A wrong repair would change a size someone chose on 1.0.28, with no evidence.
   - **Silent when no record differs.** Every CSV row is rendered under both rules, up to 500. A template
     with a serial or date has no list to check, so it warns, without sizes unless its first value
     already differs.
   - **A plain frame in this state says nothing.** It burns its stored geometry, and an edit shows the
     new fit on the canvas.
3. **The repair is always announced.** Someone who accepted 7.48 mm burns on 1.0.28 will get 10.00 mm,
   and the file cannot show that was a choice. The warning names the text and both sizes and says to
   lower Size if the smaller size was kept on purpose.
4. **What the file holds raises the notices, not the release notes.**
   - **Variable records move:** a bent, path or framed variable text from before schema 19, or a framed
     one from schema 19.
   - **Images burn more:** from before schema 19, an output Image operation with Dot Width on Grayscale
     or Pass-Through, or Pass-Through that does not line up with the scan by `passThroughLinesUpWithScan`.
     A dither with Dot Width and an upright Pass-Through image stay silent.
   - **Blue Noise is left out.** ADR-649 Amendment 1 changed it by 0.01 % dose in the audit's image.
5. **Every reader gives them, and Job Review repeats them.** They are `ProjectLoadNoticeFlags`, so Open,
   New from template, autosave Restore and a sheet switch all say the same (ADR-673 Amendment 1).
   - A frozen production design is read only at output, so the file's open reports what it holds.
   - Job Review reads them from memory, keyed by object id, so a new or replaced project leaves them
     behind and a deleted text stops warning. They are not saved, so a project reopened after saving
     says nothing.
   - **Two toasts at most,** because only the newest three render and "Opened" comes first.

### The name below the frame (R7-P2-1)

The audit's Casual Hand name that ends 1.883 mm below the frame bottom is one case of R4-P1-1: the shared
baseline does not check the bottom edge, and "Gypsy" goes 3.552 mm below. That finding has its own fix,
so this amendment does not change the placement. The move notice covers these records in the meantime.

### Consequences

- A project saved through 1.0.28 burns its old sizes on this build, at every output and after any edit,
  and says so once.
- Three kinds of frame can stay wrong, each named by a warning: a Relief or EMS variable frame whose
  template fits at full Size under both rules, a template whose ink fills the frame on Relief, and a
  frame whose stored numbers match neither rule.
- A variable frame made on 1.0.28 can warn once though it is right. 1.0.28 had been out four days, and
  the warning asks only for a check.
- The cost of a loaded project with no candidate frames is one object scan. Only an older file pays for
  rendering.
- KerfDesk builds at schema 20 cannot open a project this build saves. No release was at schema 20.
- A new release must add its golden projects (`src/__fixtures__/returning-user/README.md`).

### Limits

- The last-digit match relies on the same arithmetic on the saving and reading builds. If a future engine
  or font fairing differs, a frame falls back to item 2, so it warns rather than repairs wrongly. The
  EMS fairing uses `Math.hypot` and `Math.acos`.
- Autosave, Open and the rest were tested at the loader and notice level, not by rendering the toast in
  a window.
- No laser ran. Burn figures are read from emitted moves.

### Verification

Every project below was saved by the release it names, through its own builders and
`prepareProjectForPersistence` (`adf300522` for 1.0.27, `33bc394c6` for 1.0.28), with a sidecar of burns
measured on that build. The numbers match the audit's: ANNA 39.588 × 10.000 on 1.0.27, 29.612 × 7.480
through 1.0.28.

- A one-off sweep with the same releases (not kept in the repository): 4 single-line fonts × 6 frames,
  variable and plain.
  - 0 false fires on 240 frames that should stay under the em rule: 192 made on 1.0.28 at Size 6, 10, 14.706
    and 20, and 48 converted frames rebuilt by an edit on 1.0.28.
  - 34 repairs on 48 converted frames. All 140 records of the 20 repaired variable frames are byte-identical
    to a direct open.
  - 14 frames stayed as they were: 11 plain and 3 variable. Two variable ones warn (Decorous 80 × 15, Nixish
    40 × 20), and no record differs in the third (Relief 80 × 30).
  - 3 of the 96 variable frames made on 1.0.28 warn though they are right.
- `src/ui/text/returning-user-projects.test.ts`:
  - 1.0.27 → 1.0.28 → this build, for Relief, Casual Hand and Nixish: every record's G-code is byte-identical
    to a direct open, which covers the Casual Hand records that moved a further 2.726 mm, and each size
    matches the 1.0.27 sidecar. A plain frame keeps 39.588 × 10.000 through an edit.
  - No false repair: a direct 1.0.27 open, frames made on 1.0.28 at the new sizes, and frames rebuilt by an
    edit on 1.0.28.
  - Saving twice is byte-identical, and the second open neither migrates nor warns.
  - On `origin/main` without this change, its chain tests fail: ANNA burns 29.612 mm.
- `src/ui/text/returning-user-notices.test.ts`:
  - Each of the three notices at open, and silence for the unaffected 1.0.27 and 1.0.28 projects.
  - The routes: template, autosave, sheet switch and frozen production design, and Job Review.
  - R7-P3-2: a whole 1.0.27 job compared with its sidecar. Text sizes, the tabbed rectangle and the sketch
    are unchanged; the images burn +65.4 % and +37.6 % dose; the near-closed CNC profile grows +3.175 ×
    +4.762 mm (ADR-672).
- `scripts/verify-upgrade-project.test.mjs` and `scripts/installed-app-file-io.test.mjs`: schema 21 is
  current and 20 a known upgrade.
