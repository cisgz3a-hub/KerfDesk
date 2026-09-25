## ADR-322 Amendment 1 - A saved copy that predates a preset correction is named in Job Review (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

### Context

Item 6 says saved and custom values and profiles are not silently migrated. Device profiles are
saved whole, so a correction to a built-in preset never reaches a copy saved before it. #894
corrected presets in the catalog only:

- the xTool D1 Pro origin, from front-left to rear-left (xTool's own LightBurn device file mirrors
  Y);
- the Sculpfun S30 bed, from 410 x 400 mm to 380 x 385 mm.

Its brand presets also kept `catalogVersion` 2026-09-19, so the G-code header could not tell old
content from corrected content.

A D1 Pro user who saved the preset before 2026-09-24 therefore kept getting jobs mirrored front to
back, the defect #894 describes, and nothing said the preset had changed. The only existing
saved-copy check was #879's, for air output only (ADR-370). The 2026-09-25 audit of PRs #845-#904
found this (SET-1).

### Decision

1. `preset-corrections.ts` records each correction to a preset whose failure is silent: the preset
   ids, the value it used to ship and the value it uses now. A wrong baud rate fails at Connect,
   so it is not listed.
2. A saved profile copy of that preset that still holds exactly the old value predates the
   correction. Job Review then shows an advisory naming the old and corrected values, what the old
   value does, and where to change it. Any other value is the operator's own and is left alone, so
   an S30 extension kit's 380 x 920 mm bed, for example, is not flagged.
3. Nothing is migrated or refused. Item 6 stands, and the advisory never blocks save or Start
   (PROJECT.md non-negotiable 21).
4. A preset whose content is corrected gets a new `catalogVersion`: 2026-09-24 for the xTool D1 Pro
   and S30 presets. Its "Source checked" date stays the date the sources were read.

### Consequences

- Operators with a saved copy of a corrected preset learn about the correction at the next Job
  Review.
- A one-click "apply the corrected values" offer in Machine Setup, as ADR-370 gives air output,
  and the same check for catalog bit copies (the Amana O-flute count), remain follow-ups.
- A correction that is not recorded in `preset-corrections.ts` still reaches no one.
