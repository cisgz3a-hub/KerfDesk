## ADR-306 Amendment 3 - An Artwork bit change names the hand-edited values it keeps (2026-10-23)

**Status:** Accepted; software-verified through unit and component tests, hardware qualification pending. |
**Date:** 2026-10-23

ADR-306 carries two unnumbered amendments in `DECISIONS.md` (CNC setup within Essentials,
2026-09-21; direct operation choices, 2026-09-22). This is the third. It changes no Frame or Start
policy and adds no guard, refusal or confirmation (ADR-306 decision 9).

### Context

The 2026-09-22 amendment lets the operator choose an operation's bit and material on the Artwork
card. A bit change refreshes material-recipe feeds, "while manual cutting values remain exact".
CNC audit v1 (`docs/audits/2026-10-23-cnc-v1/F4-cnc-depth-feeds.md`, F4-P2-1, confirmed by an
independent refuter) found that the card hid which of the two happened:

1. Choose Hardwood with a 1/4" end mill: feed 2400, plunge 960, depth per pass 2.5.
2. Type a depth per pass of 2.
3. Choose a 1/16" end mill.

The operation kept 2400 / 960 / 2.0. The 1/16" Hardwood recipe is 960 / 380 / 0.6, so this is about
2.5 times its chip load (0.10 against 0.04 mm per tooth) and 3.3 times its depth per pass. The
Material select still read Hardwood. Its tooltip said "a new bit refreshes them". Job Review named
Hardwood feeds, and nothing warned. Only the collapsed Feeds calculator showed the new bit's values.
Machine Setup's Save and the bit library warn about the same change (`CNC_RETAINED_FEEDS_WARNING`).

ADR-233 decision 5 already says that editing feed, plunge, spindle or depth per pass "clears
automatic provenance and any stale material label". The hand-edit path cleared the provenance but
kept the label.

### Decision

1. **A hand edit makes the operation Manual.** Changing feed, plunge, spindle speed or depth per
   pass on the Artwork card, or through Remote Control, clears both the material recipe and the
   material label, as ADR-233 decision 5 requires (`withManualCncFeedPatch`). The Material select,
   the Feeds calculator, the Startup Tool Plan and Job Review then all read Manual. Committing a
   value unchanged clears nothing.
2. **The numbers stay exact.** As before, a bit change keeps a Manual operation's feed, plunge,
   spindle speed and depth per pass. A material-recipe operation is recalculated for the new bit.
3. **The card says what it kept.** When a primary bit choice on the Artwork card keeps all four
   values for a different cutter, a note under Bit and material names them. Machine Setup and the
   bit library use the same detection (`cncOperationKeptFeedsAfterToolChange`). The note reads,
   for example: "Bit changed. Kept from the previous bit: feed 2400 mm/min, plunge 960 mm/min,
   spindle 12,000 RPM, depth per pass 2 mm. Check them for 1.588 mm (1/16") end mill before
   cutting."
   Lengths and feeds follow the display unit (ADR-629).
4. **The note offers the material for the new bit.** When the card knows the material the values
   last followed, the note shows that material's starting values for the new bit. That is the
   operation's label, or the material a hand edit or Manual took off the operation while the card
   was open. **Use [material] values** applies them in one undo step, the same transform as
   choosing that material. **Keep these values** dismisses the note. Without a known material, the
   note asks the operator to choose one. This memory belongs to the card and is not saved with the
   project. The note leaves when the bit or any of the four values changes.
5. **The Material tooltip tells the truth.** It reads: "Choosing a material applies its starting
   feed, plunge, spindle speed and depth per pass, and a new bit refreshes them. Editing one of those
   values sets this to Manual, which keeps your numbers when the bit changes." This replaces the
   wording quoted in ADR-481 item 3.
6. **Feed drafts survive the label change.** The card used to restart its feed and depth boxes when
   the material label changed. A hand edit now clears that label while its box still has focus, so
   only the bit and the card's own material and bit choices restart them.

The note is information, not a gate. It does not block the bit choice, Save, Frame or Start, and
Job Review keeps its existing warnings.

### Consequences

- An operator who edits a material's values and then changes the bit sees the kept numbers and
  the new bit's starting values side by side, with one click to switch.
- Projects saved before this change can still hold a material label without a recipe. A bit change
  there keeps the numbers and the label, and the note offers that material for the new bit.
- Machine Setup's toast keeps its existing wording. The Artwork card does not toast, because a
  toast cannot carry the re-apply action (`toast-store.ts`).

### Related fixes in the same change (no contract wording changes)

- **F4-P3-1:** Job Review's "N passes" counts the tab-top level the compiler adds to a closed
  tabbed profile (`depthsWithTabTopPass`, now shared from `cnc-tabs.ts`). For example, 6 mm at
  2.5 mm per pass with 2 mm tabs cuts −2.5, −4, −5 and −6 and now reads 4 passes, not 3.
- **F4-P3-2:** a drill group's feed is its plunge feed, the feed every peck runs at. It used to
  name min(feed, plunge), so with plunge 2000 and feed 800 the header and Job Review said feed 800
  while the program drilled at F2000. Only that header comment changes in the emitted G-code
  (`EMITTER_REVISION` v26).

### Verification

- `src/ui/layers/CncKeptFeedsNotice.test.tsx` drives the real Artwork card and store through the
  audit's sequence. It covers the Manual label, the note, the re-apply action, its undo step, the
  feed box staying mounted, the no-material case, dismissal, and the silent recipe case.
- `src/ui/state/cnc-feed-provenance.test.ts` and `src/ui/remote-control/cnc-operation-audit.test.ts`
  cover the label rule. `src/ui/laser/job-review/job-review-cnc-depth.test.ts` checks the counts
  against compiled levels. `src/__fixtures__/cnc-repair/drilling.test.ts` checks that every fed
  move, the group feed and the header agree.
- Software verification does not qualify feeds, speeds, chip load or a physical cut.
