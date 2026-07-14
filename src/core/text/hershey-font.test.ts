import { describe, expect, it } from 'vitest';
import { hersheyGlyphForCharacter, parseHersheyJhf } from './hershey-font';
import { HERSHEY_SIMPLEX_JHF } from './hershey-simplex-data';

describe('Hershey JHF parser', () => {
  const glyphs = parseHersheyJhf(HERSHEY_SIMPLEX_JHF);

  it('maps printable ASCII in file order and preserves pen-up strokes', () => {
    const capitalA = hersheyGlyphForCharacter(glyphs, 'A');

    expect(capitalA?.right).toBeGreaterThan(capitalA?.left ?? 0);
    expect(capitalA?.strokes).toHaveLength(3);
    expect(capitalA?.strokes.every((stroke) => stroke.length >= 2)).toBe(true);
  });

  it('substitutes a visible question mark for unsupported glyphs', () => {
    expect(hersheyGlyphForCharacter(glyphs, 'é')).toEqual(hersheyGlyphForCharacter(glyphs, '?'));
  });
});
