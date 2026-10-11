import { describe, expect, it } from 'vitest';
import bidiFactory from 'bidi-js';
import { bidiCharacters, bidiLineCharacters, visualBidiRuns } from './text-bidi';
import { textScripts } from './text-script-runs';
const bidi = bidiFactory();
const scripts = (text: string) => textScripts(bidiCharacters(text, bidi), bidi);

describe('script and bidi itemisation', () => {
  it('separates same-direction Latin and Indic scripts while retaining attached marks', () => {
    expect(scripts('Aदे')).toEqual(['Latn', 'Deva', 'Deva']);
    expect(scripts('a\u0301α')).toEqual(['Latn', 'Latn', 'Grek']);
  });

  it('resolves shared Japanese script-extension marks from the adjacent script', () => {
    expect(scripts('カー')).toEqual(['Kana', 'Kana']);
    expect(scripts('ひー')).toEqual(['Hira', 'Hira']);
    expect(scripts('ーカ')).toEqual(['Kana', 'Kana']);
  });

  it('keeps matched punctuation in the surrounding script across a script change', () => {
    expect(scripts('A(漢)B')).toEqual(['Latn', 'Latn', 'Hani', 'Latn', 'Latn']);
  });

  it('classifies supplementary RTL Adlam as one character, with UTF-16 source offsets', () => {
    const points = bidiCharacters('A \u{1e922}\u{1e923}', bidi);
    expect(points.map(({ start, end }) => [start, end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 4],
      [4, 6],
    ]);
    expect(points.slice(2).map(({ level }) => level % 2)).toEqual([1, 1]);
    expect(textScripts(points, bidi).slice(2)).toEqual(['Adlm', 'Adlm']);
  });

  it('resets trailing soft-line whitespace to the original paragraph level', () => {
    const points = bidiCharacters('א A B', bidi);
    const line = bidiLineCharacters(points.slice(2, 4));
    expect(line.map(({ level }) => level)).toEqual([2, 1]);
    expect(
      visualBidiRuns(line)
        .map(({ text }) => text)
        .join(''),
    ).toBe(' A');
  });
});
