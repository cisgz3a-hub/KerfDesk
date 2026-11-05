// One parse of each font for a batch of renders (performance audit S7-P2-1).
//
// "Advance variables per copy" renders every copy of an array, and each render
// parsed the font file again: Roboto's parse is most of a serial number's
// render. The text worker already holds one parse of a font where
// reusableOutlineFont proves the reuse cannot change any result (ADR-643), and
// a batch does the same here: a reusable font is parsed once for the batch,
// any other font for every render, as before. The parser lives only as long
// as the batch, so nothing is held after the copies are made.

import type * as opentype from 'opentype.js';
import { reusableOutlineFont } from '../../core/text/reusable-outline-font';
import { parseOutlineFont } from '../../core/text/text-to-polylines';
import type { OutlineFontParser } from './text-geometry-compute';

/** A parser for one batch: each reusable font file is parsed at most once. */
export function heldFontParser(parseFont: OutlineFontParser = parseOutlineFont): OutlineFontParser {
  const held = new Map<ArrayBuffer, Promise<opentype.Font> | null>();
  return (fontBuffer) => {
    let parsed = held.get(fontBuffer);
    if (parsed === undefined) {
      parsed = reusableOutlineFont(fontBuffer) ? parseFont(fontBuffer) : null;
      held.set(fontBuffer, parsed);
      // A font that fails to parse is tried again by the next render.
      parsed?.catch(() => held.delete(fontBuffer));
    }
    return parsed ?? parseFont(fontBuffer);
  };
}
