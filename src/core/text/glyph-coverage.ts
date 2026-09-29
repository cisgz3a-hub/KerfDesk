// Characters a font cannot draw. A CR (left by a CRLF line break) and a TAB
// are layout, not ink, yet most fonts have no glyph for them, so outline
// fonts engraved them as the missing-glyph shape and single-line fonts as
// "?". Both renderers lay text out from the normalised form below and report
// whatever the font still has no glyph for, without changing what is drawn.

/** Text as the renderers lay it out: CRs dropped (LF breaks lines) and TABs as spaces. */
export function textForLayout(content: string): string {
  return content.replace(/\r/g, '').replace(/\t/g, ' ');
}

/** Each character of `text` the font has no glyph for, once, in reading order. */
export function missingCharacters(
  text: string,
  hasGlyph: (character: string) => boolean,
): ReadonlyArray<string> {
  const checked = new Set<string>(['\n']);
  const missing: string[] = [];
  for (const character of text) {
    if (checked.has(character)) continue;
    checked.add(character);
    if (!hasGlyph(character)) missing.push(character);
  }
  return missing;
}
