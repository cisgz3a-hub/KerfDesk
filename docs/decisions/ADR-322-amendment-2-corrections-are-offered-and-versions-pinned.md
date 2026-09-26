## ADR-322 Amendment 2 - Corrected presets and bits are offered in one click, and preset versions are pinned (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

### Context

Amendment 1 made Job Review name a saved copy of a built-in preset that predates a catalog
correction: the xTool D1 Pro's front-left origin, and the Sculpfun S30's 410 x 400 mm bed. It left
three parts of the 2026-09-25 PR audit's SET-1 finding for later:

- **The fix.** The advisory pointed to Machine Setup, which had no way to apply the correction
  except retyping it.
- **Catalog bits.** Adding a catalog bit copies it whole, with its `catalogId`, into the custom
  library and the project. #894 gave both Amana O-flute ball-nose bits their single flute. A copy
  saved before still has no flute count, so recipe feeds assume two flutes and double the chip
  load, and nothing says so.
- **Versions.** The G-code header, recovery provenance and saved copies record a preset's
  `catalogVersion`. #894 changed preset content without changing the version; #915 bumped it
  afterwards by hand. Nothing kept content and version in step.

### Decision

1. **Machine Setup offers the corrected preset value.** `stalePresetCorrections` now returns the
   corrected values as a `patch`, read from the current preset for the fields each correction
   changed. A **Preset correction** row under Origin names the old and corrected values and what
   the old value does, with one button to use the corrected value. The button applies it through
   the same update as the rows beside it. Job Review's advisory now points to that offer.
2. **Catalog bits get the same treatment.** `staleCatalogBitCorrections` records each catalog bit
   correction as the catalog ids, the value the catalog used to ship, and how to read the fix from
   the current entry. A saved copy that still holds exactly the old value predates the fix; any
   other value is the operator's own. It covers the Amana 51814 and 51818 ball-nose bits with no
   flute count.
   - In Machine Setup's bit library, the bit's row offers **Use 1 flute** beside its flute count.
   - Job Review warns when the prepared job's tool plan runs such a copy.

   Both are warnings or offers only, never refusals (PROJECT.md rule 21), and nothing is migrated
   on its own.
3. **Preset content is pinned to its version.** `profile-catalog-content.test.ts` records, for
   every catalog preset, its `catalogVersion` and a hash of its content. Keys are sorted, and the
   version itself is excluded. A changed preset fails the test until its version is bumped and the
   new pair recorded, and the failure message says so. A change that fails silently on saved copies
   also belongs in `preset-corrections.ts`.

### Consequences

- An operator who saved an xTool D1 Pro or Sculpfun S30 profile, or an Amana O-flute ball-nose bit,
  before #894 is told what changed and fixes it with one click.
- Preset edits carry their version bump, so the G-code header and recovery provenance always tell
  preset content apart. The pinned table is a review aid, not a proof: a reviewer should question
  an edit that changes a recorded hash under an unchanged version.
- Not changed: bits have no version field, so their corrections are listed by hand, as presets'
  were before this amendment.

### Evidence

- `preset-corrections.test.ts`: the stale xTool copy's patch is `{ origin: 'rear-left' }`, and the
  stale S30 copy's is `{ bedWidth: 380, bedHeight: 385 }`.
- `PresetCorrectionOffer.test.tsx`: a stale copy shows the offer, and a click applies exactly the
  patch. A current preset or the operator's own value shows nothing.
- `cnc-bit-catalog-corrections.test.tsx`: both Amana copies with no flute count are named with
  `{ fluteCount: 1 }`. The operator's own count, other catalog bits and hand-made bits are not.
  The bit-library offer calls the flute count change once and disappears once a count is set. With
  detection disabled, three of these tests fail.
- `stale-catalog-bit-warnings.test.ts`: warns only for a stale copy the job runs.
- `profile-catalog-content.test.ts`: records all 18 presets. Changing the S30 bed width to 381 mm
  fails it with the bump instruction.
