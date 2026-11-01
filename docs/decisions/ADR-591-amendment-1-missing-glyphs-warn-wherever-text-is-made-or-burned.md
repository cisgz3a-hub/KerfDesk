## ADR-591 Amendment 1 - A character the font has no glyph for is a warning wherever text is made or burned (2026-10-28)

**Status:** Accepted; software-verified through tests that drive the real remote adapter, the MCP
output schemas, output preparation with bundled fonts, and the rows preview. Not tested on a real
phone, against the production relay, or on a machine. | **Date:** 2026-10-28

Extends the Decision's first bullet, "unsupported font glyphs remain visible warnings rather than a
guessed font substitution", from the text editor to every other way text is made or burned.
Follows rolling audit v7 findings L3-P1-3 and L3-P1-4 (both P1), which an independent refuter and
the coordinator confirmed in main's code. Adds no Frame or Start gate (ADR-565).

### Context

The renderers report the characters a font has no glyph for (`missingCharacters`), but only the
open text editor's hint read the report. A font draws such a character as its `.notdef` glyph:
Roboto, Poppins, Tinos and Anton burn a box, while Inconsolata, Pacifico, Great Vibes and Stardos
Stencil have an empty `.notdef` and burn nothing.

- Remote `add_text`, `update_text` and `apply_edits` returned plain success for "Café 李" in
  Pacifico, which burned "Café".
- Variable records were rendered at output with no check. A guest list imported later, for
  example from a barcode's Variable panel, burned the Pacifico record "李" as nothing and "Zoë 李"
  without 李. The prepared job's advisories were empty, and the rows preview showed 李 in a
  browser font.

### Decision

1. **Warn, never refuse or substitute.** A missing character is a policy finding, so it is a
   warning (AGENTS.md, ADR-228). Remote text whose ink is empty because every character is missing
   is still refused, as before: there is nothing to place.
2. **One wording.** `src/core/text/missing-glyph-words.ts` writes "Pacifico has no 李; each
   engraves as a box, or not at all." (single-line fonts: "each engraves as ?"). The text editor's
   hint, remote receipts, PC toasts and output advisories use it.
3. **Remote text says so.**
   - `add_text`, `update_text` and each `add_text` item of `apply_edits` return
     `notices: [{ level: 'warning', message }]`, the contract of ADR-125 Amendment 2.
   - The receipt names the characters only when the client sent the wording. An `update_text` that
     changed only other fields counts them ("…has no glyph for one character of this text…
     Check it on the PC."), because reading the text needs artwork sharing.
   - The PC shows the same warning as a toast, always naming the characters.
   - The MCP output schemas of `add_text` and `update_text` accept `notices`, and the tool
     descriptions ask the agent to tell the user.
   - The phone's Add text and text edit sheets show the warning as a toast.
4. **Output says so for every record it burns.** Preparing output checks each variable record it
   renders. A missing character in text the output burns (inside its scope, on an output layer)
   adds a `variable-text-missing-glyphs` advisory to the prepared output, naming the record and the
   characters: "Variable text “Zoë 李” (CSV record 2): Pacifico has no 李; …". Start and Save each re-run the project's preflight when they emit, and that
   preflight cannot see evaluated records, so both add these advisories to their own warnings
   (`variableRecordAdvisories`). Job Review lists them, and Save shows them as warning toasts.
5. **The rows preview shows what burns.** When it is open, it checks its page of records against
   the font. A missing character shows as a marked box (as `?` for a single-line font), and the
   Layout column starts "No 李 in this font".

### Consequences

- A remote client, a phone operator and a PC operator each learn that a character will burn as a
  box or not at all before the burn, on the screen they are using.
- The relay Worker re-parses results with the output schemas bundled into it, so relayed `add_text`
  and `update_text` receipts carry `notices` only after a Worker redeploy (ADR-125 Amendment 3).
  The local MCP server uses the desktop's own schemas. The phone bundle and MCP App are rebuilt.

### Limits

- Output checks the records it burns. Records not in this output are flagged only by the rows
  preview.
- A production run's rows are rendered when the run is prepared, so their output has no record
  check yet. Importing a CSV does not yet check every variable text against it.
- The registration-jig text editor shows no missing-character hint.
