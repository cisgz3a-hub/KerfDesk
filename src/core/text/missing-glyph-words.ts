import type { EmbeddedFont } from '../scene';
import { findFontEntry } from './font-registry';

// ADR-591 Amendment 1. A character the font has no glyph for is a visible warning wherever text
// is made or burned: the text editor's hint, a remote text receipt and the output advisory for a
// variable record use these words.

/** A character as a warning names it: spaces, controls and combining marks would be invisible. */
export function missingCharacterLabel(character: string): string {
  if (/^[\p{L}\p{N}\p{P}\p{S}]$/u.test(character)) return character;
  const code = character.codePointAt(0) ?? 0;
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** What the burn draws for a character the font lacks. */
export function missingCharacterOutcome(fontKey: string): string {
  return findFontEntry(fontKey)?.geometry === 'single-line'
    ? 'each engraves as ?'
    : 'each engraves as a box, or not at all';
}

/** "<font> has no 李 é<where>; each engraves as a box, or not at all." */
export function missingCharactersSentence(
  fontName: string,
  missing: ReadonlyArray<string>,
  fontKey: string,
  where = '',
): string {
  const named = missing.map(missingCharacterLabel).join(' ');
  return `${fontName} has no ${named}${where}; ${missingCharacterOutcome(fontKey)}.`;
}

/** The font's name as the font picker shows it. */
export function fontDisplayName(
  fontKey: string,
  embeddedFonts: ReadonlyArray<EmbeddedFont> | undefined,
): string {
  return (
    findFontEntry(fontKey)?.displayName ??
    embeddedFonts?.find((font) => font.key === fontKey)?.fileName ??
    'This font'
  );
}
