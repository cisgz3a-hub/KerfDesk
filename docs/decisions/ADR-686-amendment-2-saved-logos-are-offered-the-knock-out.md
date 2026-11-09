## ADR-686 Amendment 2 - A logo saved before the knock-out is named at open and in Job Review, and Leave white unburned applies it as one Undo step (2026-11-08)

**Status:** Accepted. Amends ADR-686 Consequences. Fixes rolling audit v10 V2-P2-1 (raised P2;
its refuter, `docs/audits/2026-11-07-rolling-v10/V2-returning-user.md`, changed it to **P1**).
Tested through File > Open of a project 1.0.29 saved (`df2279e26`, schema 21) and the store; not
burn-tested. | **Date:** 2026-11-08

### Context

ADR-686 runs the knock-out on import and Re-import only. A logo imported on 1.0.29 keeps its white
on its own Fill operation, so on main it still burns the white a second time over the black:

- U3's logo +960 mm of lit travel (+19.9 % dose), a white-letter plate +1,140 mm;
- the refuter's `style=` star and CSS-class ring +65.6 % and +83.2 % lit length.

The canvas paints the white in plain ink (ADR-620), black on black. Open, Preview and Job Review
said nothing. No released build has the knock-out (#1556 came after 1.0.29), so every saved project
with an imported logo is in this state.

The refuter ruled out applying the knock-out at open: ADR-686 Decision 3 makes burning the white an
operator's choice with Undo, and a returning user does not expect a saved burn to change unasked
(L11). A white whose operation already has Output off (U3's workaround) burns correctly already.

### Decision

*Amended by Amendment 4: copies that lost `svgImport` are counted and knocked out one by one, the
count is exactly what the button removes (darker fills with Output off and imports left as parsed
count nothing), and the texts no longer claim parity with a new import.*

1. **Open never changes the burn.** Every reader of a saved project (File > Open and its routes,
   autosave Restore, New from template, a sheet switch) passes the project to
   `pushProjectLoadNotices`, which reads the artwork itself (`countBurningImportedWhites`), whatever
   build saved it. When an SVG import (objects sharing `svgImport.id`) has a solid white Fill that
   burns beside a darker fill, a warning toast says: "This project has 1 white shape from an SVG
   import that burns over the darker fill under it, as KerfDesk 1.0.29 and earlier imported white.
   Its burn is unchanged. To leave the white unburned, as a new import does, choose Tools > Leave
   Imported White Unburned, or Leave white unburned in Job Review. One Undo burns the white again."
2. **What counts** is the import rule (Amendment 1) without geometry, so Job Review can ask on every
   rebuild: an unmarked `#ffffff` Fill path in an import that also has a darker fill, where at least
   one of the path's operations has Output on. A white whose operations all have Output off is left
   out, and so is white the operator chose to burn (`whiteInk: 'kept'`, Amendment 3).
3. **Job Review repeats it** as a beginner note ("White in an imported logo burns: …"), open at
   once, with a **Leave white unburned** button, as Cut last is offered (ADR-480 Amendment 2). It
   never gates Start. A frozen second pass shows no button.
4. **Leave white unburned** (`leaveSavedWhiteUnburned`, also Tools > Fill repair > Leave Imported
   White Unburned) runs the import's own knock-out on each import, skipping white with Output off,
   as one Undo step named "Leave white unburned". Removed parts leave the selection. A success toast
   names the count. An import whose white would cover every darker shape is left as parsed, as a
   fresh import leaves it.
5. **Undo is the choice to burn white.** The history copy marks the white shapes it would have cut
   as `kept`, so after Undo the notice and the row stop asking, and an unchanged Re-import keeps
   that choice (Amendment 3).

### Consequences

- A returning user hears about the double burn on open and before Start, and one click gives the
  burn a fresh import gives. Measured on the 1.0.29 golden, the whole job's lit length after Leave
  white unburned equals the same SVGs imported fresh on main.
- A project the operator never fixes is named on every open; Job Review keeps the row until the
  white is left unburned, turned off, or kept with Undo.
- **Update notes (1.0.30):** "Logos imported before this update can still burn their white shapes
  over the black. Opening one now says so, and Leave white unburned (Tools menu or Job Review) cuts
  the white out as a new import does; one Undo puts it back." The notes are written at release time
  (`docs/releases/desktop-update-notes.json` still holds 1.0.29's), so this line is recorded here and
  in the PR for the release author.
- **Not covered:** white strokes and near-white (as ADR-686); PDF/AI pages (one Line artwork); a
  see-through white saved by 1.0.29, which has no Amendment 1 mark and counts as paper here.
- **Tests:** `src/ui/text/returning-user-white-fills.test.ts` opens `1.0.29-white-logos.lf2.gz`
  (saved by 1.0.29's own parser, store and `prepareProjectForPersistence`), checks its burn equals
  the 1.0.29 sidecar at open, the notice and the row, the skipped Output-off logo, and that Leave
  white unburned burns what a fresh import burns, with one Undo back to the sidecar.
  `src/ui/state/svg-white-fill-knockout-v10.integration.test.ts` ("V2-P2-1") covers the store
  action, Undo and Redo, and the cases that stay silent.
