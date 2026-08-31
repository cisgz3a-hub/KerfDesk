import { describe, expect, it } from 'vitest';
import { scanCompleteGcodeWords, scanGcodeWords, stripInlineComments } from './word-scan';

describe('scanGcodeWords', () => {
  it('scans letters, signed values, and spacing variants', () => {
    const words = scanGcodeWords('G1 X-10.5 Y .25 f600');
    expect(words.map((word) => [word.letter, word.value])).toEqual([
      ['G', 1],
      ['X', -10.5],
      ['Y', 0.25],
      ['F', 600],
    ]);
  });

  it('reports matched lengths for the junk-line heuristic', () => {
    const words = scanGcodeWords('G1X5');
    expect(words.reduce((sum, word) => sum + word.matchedLength, 0)).toBe(4);
  });

  it('returns empty for wordless text', () => {
    expect(scanGcodeWords('%')).toEqual([]);
  });
});

describe('scanCompleteGcodeWords', () => {
  it('accepts compact and spaced complete words', () => {
    expect(scanCompleteGcodeWords('G1X5 Y -2.5')).toEqual(scanGcodeWords('G1X5 Y -2.5'));
  });

  it('does not prefix-coerce a malformed numeric word', () => {
    expect(scanCompleteGcodeWords('G1 X10junk')).toBeNull();
  });

  it('accepts block-delete and line-number/checksum framing', () => {
    expect(scanCompleteGcodeWords('/G1 X10')).toEqual(scanGcodeWords('G1 X10'));
    expect(scanCompleteGcodeWords('N1 G1 X10*23')).toEqual(scanGcodeWords('N1 G1 X10'));
  });
});

describe('stripInlineComments', () => {
  it('removes paired parens and semicolon tails', () => {
    expect(stripInlineComments('G1 (feed) X5 ; end')).toBe('G1   X5');
  });

  it('leaves an unclosed paren in place (junk downstream — pinned behavior)', () => {
    expect(stripInlineComments('G1 (oops X5')).toBe('G1 (oops X5');
  });
});
