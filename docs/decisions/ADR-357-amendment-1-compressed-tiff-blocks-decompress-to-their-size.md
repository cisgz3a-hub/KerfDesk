## ADR-357 Amendment 1 - A compressed TIFF block decompresses to the size of its rows (2026-10-28)

**Status:** Accepted | **Date:** 2026-10-28 | **Amends:** ADR-357 item 6

### Context

Item 6 decodes TIFF with the pinned `tiff` package (7.1.3). For an LZW or Deflate page it
decompresses each strip or tile and then reads the samples the block's rows need, so the length of
the decompressed block was checked only by those reads:

- A block that decompressed short failed inside the decoder with "Offset is outside the bounds of the
  DataView", although `pixelsForPage` has the message "Incomplete TIFF pixel data."
- A block that decompressed long was read in part and decoded without a word.

KerfDesk's own PNG reader refuses the second case ("PNG decompressed data is too long."). This
amendment is parser hardening: it gives the TIFF decoder the same output bound.

### Decision

1. **Each compressed block is measured before decoding.** `validateTiffPixelLayout` decompresses
   every LZW or Deflate strip or tile once, counting the bytes and keeping none
   (`tiff-decompressed-length.ts`). The count stops as soon as it passes the most the block may hold:
   - a strip: RowsPerStrip whole rows, at most the image height, of width × samples per pixel × bits
     per sample;
   - a tile: the whole tile.

   Past that bound the import stops with "TIFF decompressed data is too long."
2. **A short block is named.** A block that decompresses to fewer bytes than its rows need, or whose
   Deflate stream ends early, stops with "Incomplete TIFF pixel data." A stream that cannot be
   decompressed stops with "TIFF compressed data is damaged."
3. **A last strip may be padded.** A last strip that holds all RowsPerStrip rows, the image's and
   padding, is accepted, as libtiff accepts it. The decoder reads only the image's rows.
4. **Deflate is counted as the decoder decompresses it.**
   - fflate's streaming `Inflate`, `Unzlib` or `Gunzip` does the count, a chunk of input at a time.
     The stream is chosen from the first bytes, as the decoder's `decompressSync` chooses.
   - A gzip-wrapped block's trailer is held to the same bound, because `gunzipSync` sizes its output
     from it.
   - fflate 0.8.3, already in the bundle through `tiff`, becomes a direct dependency.
5. **LZW is counted by the decoder's own steps.** The count follows `tiff` 7.1.3's `lib/lzw.js` step
   for step, keeping only the length of each table entry. That reader's table outlives a block, so a
   code naming an entry the block has not yet made would repeat an earlier block's bytes. Such a
   block is damaged.
6. Uncompressed blocks keep their existing check.

### Consequences

- Complete compressed TIFFs decode as before. Each compressed block is decompressed twice: once to
  count, once to decode.
- A block that holds more than a full strip or tile is refused. Before, the decoder read part of it.
  libtiff stops at the block's rows instead, but the pinned decoder has no way to stop.
- An upgrade of `tiff` re-checks the LZW count against `lib/lzw.js`, and the Deflate choice against
  fflate's `decompressSync`. `tiff-pixel-layout.test.ts` covers both encodings, the padded last
  strip, tiles, gzip trailers and damaged codes.
