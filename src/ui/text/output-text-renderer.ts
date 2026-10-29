import { findFontEntry } from '../../core/text';
import { cncStrokeFontMissingCharacters } from '../../core/text/cnc-stroke-font';
import { styledTextContent } from '../../core/text/text-style';
import { parsedFontMissingCharacters, parseOutlineFont } from '../../core/text/text-to-polylines';
import type { VariableTextRenderer, VariableTextRenderInput } from '../../io/gcode';
import { loadFont } from './font-loader';
import { renderVariableText } from './render-variable-text';

// ADR-591 Amendment 2. Output checks every text it burns for characters its font has no glyph
// for, not only variable records: Bake, a production row, the jig editor and any later route make
// plain text, and plain text burns the geometry it was made with.

/** renderVariableText, with the glyph check output runs on plain text. */
export const outputTextRenderer: VariableTextRenderer = Object.assign(
  (input: VariableTextRenderInput) => renderVariableText(input),
  { missingCharacters: textMissingCharacters },
);

type ParsedFont = Awaited<ReturnType<typeof parseOutlineFont>>;

// Reading the character map takes one parse of each font and never a layout. The parsed font
// serves only character-map lookups, which opentype.js never changes as it draws (ADR-643).
const parsedFonts = new WeakMap<ArrayBuffer, Promise<ParsedFont>>();

/** The characters a text engraves that its font has no glyph for, as its render reports them. */
export async function textMissingCharacters(
  input: VariableTextRenderInput,
): Promise<ReadonlyArray<string>> {
  const { text, content, project } = input;
  const engraved = styledTextContent(content, text.textStyle);
  if (findFontEntry(text.fontKey)?.geometry === 'single-line')
    return cncStrokeFontMissingCharacters(text.fontKey, engraved);
  const buffer = await loadFont(text.fontKey, project.embeddedFonts);
  return parsedFontMissingCharacters(await parsedFont(buffer), engraved);
}

function parsedFont(buffer: ArrayBuffer): Promise<ParsedFont> {
  const cached = parsedFonts.get(buffer);
  if (cached !== undefined) return cached;
  const parsed = parseOutlineFont(buffer);
  parsedFonts.set(buffer, parsed);
  // A font that fails to parse is tried again next time rather than remembered.
  parsed.catch(() => {
    if (parsedFonts.get(buffer) === parsed) parsedFonts.delete(buffer);
  });
  return parsed;
}
