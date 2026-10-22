## ADR-638 - Start review becomes a compact confirm sheet with in-place Edit and Save

**Status:** Accepted | **Date:** 2026-10-19 | **Amends:** ADR-224 (v2 revision, settings-approval
amendment)

## Context

The maintainer asked for the box that opens after Frame, when Start is pressed, to be redesigned
(chat request of 2026-10-19): less wording and more settings, a pleasing visual of the settings to
confirm, an option to edit them without going back that saves and updates the main settings before
starting, and short, simple warnings. The ADR-224 v2 dialog showed warnings as full paragraphs, the
operations as a dense table whose cells committed while typing, a separate **Approve settings**
row, a "Before you start" heading over two folded fact lists, and a verified-laser paragraph.

## Decision

The Job Review keeps its gate, its stats and its facts, and changes how they are shown:

- **Operation cards replace the table.** Each output-enabled operation (and enabled laser
  sub-operation) is a card edged in its operation colour with name, mode chip, material chip and
  artwork count. Laser cards show Power (with a meter), Speed, Passes and Air assist as large
  values; CNC cards show bit, depth, depth per pass, feed, plunge and spindle speed, read-only
  under ADR-306. The mode detail line stays under the values; the **Partial compiled summary**
  (ADR-224 Amendment, 2026-08-02) keeps its name and folds under a disclosure.
- **Edit and Save.** A laser card's **Edit** turns its four values into fields. **Save** writes
  them to the main settings through the same store actions the Artwork panel uses
  (`setLayerParam`, the ADR-317 artwork-owner overrides, `updateLayerSubLayer`) with the panels'
  limits, says when Output max feed capped the speed, and requests the immediate exact-job rebuild
  the settings-approval amendment requested. **Discard** or Escape drops the draft without closing
  the review. Nothing reaches the main settings before Save, so undo, dirty and Frame-invalidation
  behaviour are unchanged.
- **Start waits for an open edit.** While any card holds an unsaved draft, Start is disabled with
  "Save or discard your settings change first." This is a display-consistency hold, not a policy
  gate: the job must never run values other than the ones the review shows, the same reason Start
  waits while the review re-prepares. It adds no refusal and no confirmation.
- **Approve settings is removed.** Save is the explicit approval of changed values; Start still
  approves the whole review in one click.
- **Short warnings.** Each warning shows one headline: its short leading label, or its first
  sentence, cut at a word past 110 characters. The rest of its text is one click away. Warnings
  whose detail the review opened before (controller identity, router laser mode, Focus Test Z)
  open it by default. The list is always visible with a count; warnings still never block Start.
- **Quieter facts.** Stat tiles keep one line of detail, with the full detail as their hover title
  (Amendment 1: the detail now wraps, with no hover title).
  Controller and Machine facts sit side by side, folded, without the "Before you start" heading. A
  verified laser session shows a "Laser mode verified" chip in the header instead of a paragraph.
  The unverified-laser and CNC acknowledgements keep their exact prompt text, with the footnote
  shortened to "Pressing Start job confirms this."

## Consequences

- The dialog's title, the **Start job** / **Accept & Frame** / **Start second pass** buttons, the
  stat labels and the controller/machine disclosures keep their names, so end-to-end flows are
  unchanged.
- Gate contract unchanged: one affirmative click, the same acknowledgement evidence, warnings
  display-only, blockers only for refusals the readiness pipeline already issues, and placement
  read-only.
- The settings-approval amendment's Approve action and its test are retired; the card editing tests
  cover Save, clamping, invalid input, Discard, Escape, Enter and sub-operations.

### Amendment 1 - Save writes only changed fields, remote approval waits for an edit, tile details wrap (2026-10-20)

An audit of this decision found three gaps; each is closed here.

1. **Save writes only the fields that were changed.** Save re-clamped every field, so an operation
   stored at 12 000 mm/min with an Output max feed of 10 000 had `speed: 10000` written, artwork
   that owns its speed included, when only Power was edited. A field whose text is as Edit showed
   it now keeps its stored value untouched; only edited fields are parsed, clamped with the panels'
   limits and written, and the Output max feed notice appears only for an edited speed.
2. **Start waits for an open edit wherever it is approved.** The editing state moved from the
   dialog into the Job Review store. The store's Confirm does nothing while a card holds an
   unsaved draft, and a remote client (phone or MCP) sees its review withdrawn: the operation
   reads `preparing` with "A setting is being edited in the Job Review on the PC. Save or discard
   it there, then approve the new review.", an approval naming the withdrawn review is refused,
   and a fresh review is offered once the edit is saved or discarded. This is the same display
   consistency hold as before, not a policy gate.
3. **Stat tiles show their whole detail.** The one-line detail with the rest in a hover title
   could not be read by keyboard or touch; the detail now wraps under the value and the tile has
   no title.

Verification: `JobReviewOperations.editing.test.tsx` (an untouched speed above Output max feed
stays as stored), `job-review-store.test.ts` (Confirm held while a card edits) and
`machine-review.test.ts` (a remote review is withdrawn and refused during an edit, and a fresh one
starts the job once).

### Amendment 2 - One Save is one undo step (2026-10-22)

Rolling audit 2026-10-21 finding 06-P2-5: when an artwork owned an edited field, Save wrote the
operation with `setLayerParam` and then each owner group with its own override action, one undo
step each. One Undo then left a job that was neither before nor after the Save: at 40 % saved over
80 %, the owner burned `S800` again while its sibling stayed at `S400`, and the card read 40 %.

Save now writes the operation and its artwork owners through one store action,
`setLayerParamWithArtworkOverrides`, which applies the same operation edit (including the ADR-496
reseed) and the same per-artwork override writes as before, with one history snapshot. One Undo
restores the whole Save and one Redo reapplies it. The values written are unchanged.

Verification: `JobReviewOperations.save-undo.test.tsx` saves 40 % on an operation whose artwork
owns its power: one undo step, both artworks emit `S400`, one Undo returns both to `S800` with the
card at 80, and Redo returns both to `S400`.
