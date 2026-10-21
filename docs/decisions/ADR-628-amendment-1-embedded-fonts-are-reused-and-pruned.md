## ADR-628 Amendment 1 - Embedded fonts are reused and pruned, and the limit applies when a font is chosen (2026-10-21)

**Status:** Accepted. | **Date:** 2026-10-21

### Context

Decision 2 says a chosen face goes through the 32 fonts per project limit. Nothing on the choice
path counted fonts (rolling audit v2, report 13, finding P2-2):

- Every Import or System fonts choice embedded the font under a fresh `embedded:<uuid>` key, even
  when the same face was already in the project.
- No code removed a font that no text used any more, not after the text changed font and not after
  it was deleted. Each copy can be up to 10 MB, and every save carried them all.
- Trying faces for one sign, the 33rd confirmed choice made Save fail with `invalid embeddedFonts:
  expected at most 32 fonts`; autosave failed too. Undo could remove only the latest font.

### Decision

1. **The same face is one font.** Choosing a face whose bytes are already embedded uses that
   embedded font and its key; nothing new is embedded. The store applies the same rule when a text
   is committed, so every path agrees. Inserting personal artwork already did this.
2. **A font nothing names is dropped.** A font is in use while any value anywhere in the project,
   other than its own entry, is its key. That covers a text on the canvas, in a sheet, a retained
   array, a Boolean archive or a later container. Matching containers by name could miss one and
   lose a font a text still needs. A text commit drops the fonts nothing names. Undo restores the
   previous project, fonts included. Save, autosave and templates write only fonts in use, so a
   deleted text's font is not saved.
3. **The limit applies when a font is chosen.** A new face is refused in the dialog, before it is
   embedded, when the fonts in use already number 32: `This project already uses 32 embedded
   fonts, the most it can hold. Choose one of them, or change or delete text that uses a font you
   no longer need.` The font of the text being edited does not count when nothing else uses it,
   since the choice replaces it. A commit that would still pass the limit changes nothing and shows
   the same reason.

### Consequences

- Trying faces leaves only the face in use in the project and its saves. A file saved before this
  amendment opens unchanged, and its first Save drops its unused fonts.
- The in-use check walks the project when text is committed and when it is saved, skipping
  coordinate and pixel arrays. It runs only when the project has embedded fonts.
- No G-code, Frame, Start or controller behaviour changes. Text geometry is computed from the
  embedded bytes as before.

### Verification

`core/text/embedded-font-set.test.ts` (reuse, the limit with and without a font freed, a key named
deep inside a sheet), `ui/state/embedded-font-limit.test.ts` (the audit's 33 tries of one face and
of 33 faces, undo, a deleted text's font not saved, a 33rd font in use refused) and
`ui/text/AddTextDialog.font-limit.test.tsx` (the Import button reuses an embedded face and refuses
a 33rd before embedding it).
