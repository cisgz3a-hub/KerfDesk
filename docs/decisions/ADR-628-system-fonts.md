## ADR-628 - Use fonts installed on this computer

**Status:** Accepted by the maintainer's explicit instruction on 2026-10-18 ("system fonts"). Amends PROJECT.md "Out of scope" (host system-font enumeration) and builds on ADR-164's embedded-font rule.

## Context

KerfDesk bundles 21 outline fonts and 4 single-line fonts, and imports a `.ttf` / `.otf` file the operator picks. It never lists the fonts installed on the computer; PROJECT.md put host system-font enumeration out of scope. LightBurn, Inkscape and every other design tool show the installed fonts, so an operator who wants "Arial" or the font they bought has to find the file in a system folder first. On macOS many system fonts live inside `.ttc` collections the import refuses.

Chromium offers the Local Font Access API (`window.queryLocalFonts()`). It asks the operator for permission the first time, only when a page calls it from a click, and returns each installed face's names and its font data.

## Decision

1. **A System fonts list beside Import.** Wherever the text tools offer **Import** for a font, a **System fonts...** button opens a searchable list of installed fonts, by family and style, each previewed in its own face. Nothing is listed until the operator presses that button. Choosing a face embeds it.
2. **Embedded, never referenced.** The chosen face goes through the same path as an imported file: `encodeEmbeddedFont`, the 10 MB per font and 32 fonts per project limits, and the TrueType/OpenType check. The project keeps working on a computer that does not have the font (ADR-164). A face that lives in a `.ttc` / `.otc` collection is first copied out into a standalone font file holding only that face's tables.
3. **Permission stays the operator's.** The browser asks its own permission prompt. The desktop app grants the `local-fonts` permission only to its trusted renderer origin, as it does for serial and file access, and only when the page asks. The font list is held in memory while the dialog is open and is not saved, logged or sent anywhere (non-negotiable 8).
4. **Where the API is missing** (Firefox, Safari, an older browser, or a refused permission) the button explains why and **Import** keeps working.
5. **Licence notice, not a refusal.** When a face's OS/2 `fsType` says its maker limits embedding it in an editable, shareable file (Restricted License, Preview & Print only, or bitmap embedding only, since a project embeds outlines; Installable and Editable faces say nothing, and where several usage bits are set the least restrictive applies), the dialog says so before embedding it: "This font's licence restricts embedding. Keep projects that use it to yourself unless the licence allows sharing." The operator decides.

## Consequences

- Host enumeration leaves the out-of-scope list; enumeration happens only on request and leaves no trace.
- A project grows by the size of each system font it uses, exactly as it does for an imported font.
- Variable fonts embed with their default instance; picking a named instance of a variable font is out of scope.
- No G-code, Frame, Start or controller behaviour changes. Text geometry is computed from the embedded bytes as it already is.

## Verification

Unit tests cover face grouping and search, the collection extraction (table offsets, checksums, the head table's adjustment, and the face chosen by its PostScript name), the `fsType` notice, the import of the chosen face through `encodeEmbeddedFont`, the missing-API and refused-permission messages, and the desktop permission policy granting `local-fonts` only to the trusted origin.
