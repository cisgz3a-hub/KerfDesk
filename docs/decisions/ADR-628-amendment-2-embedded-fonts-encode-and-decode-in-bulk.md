## ADR-628 Amendment 2 - Embedded fonts encode and decode in bulk

**Status:** Accepted. Fixes performance audit finding S7-P2-2 (P2)
(`docs/audits/2026-11-02-performance-s1/S7-text.md`). Builds on ADR-164's embedded-font rule and
Amendment 1. Saved projects, fonts, burn, G-code and licences are unchanged. | **Date:** 2026-11-05

### Context

An embedded font is stored in the project as base64 (`dataBase64`). `src/core/text/embedded-font.ts`
built that text by appending one character at a time and read it back with `alphabet.indexOf` for
every character, on the UI thread. Choosing SimHei (9.3 MB) under **System fonts…** blocked the
window for 670 to 988 ms and then about 550 ms more, and the first edit of its text after reopening
the project blocked 385 to 466 ms. Fonts of East Asian scripts are commonly 5 to 20 MB, up to the
10 MiB project limit. Relief depth maps and the editor's artwork snapshots used a codec of the same
kind (`src/core/relief/depth-map-base64.ts`).

### Decision

1. **One codec for core.** `src/core/util/base64-codec.ts` encodes and decodes with the language's
   own `Uint8Array` base64 methods (`toBase64`, `setFromBase64`) where the engine has them, as
   Chromium 140 and Electron 44 do. Elsewhere it writes character codes into a buffer, turns each
   32,768 of them into text with one call, and reads characters through a 256-entry table. Core may
   not use the browser's `atob` and `btoa`; the `Uint8Array` methods are part of the language.
2. **Same text, same bytes, for every input.** The encoder writes canonical padded base64, as the old
   loop did. The engine decoder refuses a stray character or a misplaced '=', and skipped
   whitespace leaves it short of the expected length; either way the table decodes the text again,
   reading '=' as 0 and any other stray character as -1, as `indexOf` did.
3. **Embedded fonts and depth maps use it.** `embedded-font.ts` encodes and decodes through it, and
   `depth-map-base64.ts` encodes and decodes through it and checks its alphabet with one pattern
   instead of an `indexOf` per character. The UI's own base64 sites were already chunked or native.

### Consequences

- SimHei (9.75 MB) through `encodeEmbeddedFont` and `embeddedFontBuffer`, median of 5 after a
  discarded run, Node 25 on this PC under full load: encode 7,373 ms before, 25 ms after (827 ms with
  the table alone); decode 2,109 ms before, 28 ms after (378 ms with the table alone). The text
  hashed the same and the bytes round-tripped.
- The engine decoder is tried on any text of the right length, and the table decodes the text again
  whenever it refuses it or reads it short, so a pattern check over the whole text is not needed.
- Guard: `base64-codec.test.ts` compares both paths with the old loops on every length up to 199
  bytes, a 1 MB buffer, and malformed text.
