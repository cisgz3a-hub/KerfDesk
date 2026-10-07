import type { TextBoxSettings } from '../scene/text-box';

export type TextBoxLayout = {
  readonly content: string;
  readonly sizeMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly lineCount: number;
  readonly advanceWidthMm: number;
  readonly overflow: boolean;
};
type Input = {
  readonly content: string;
  readonly sizeMm: number;
  readonly lineHeight: number;
  readonly textBox: TextBoxSettings;
};
type Measure = (line: string, sizeMm: number) => number;

/** Wrap using the chosen face's advances; never clip or delete source content. */
export function layoutTextBox(input: Input, measure: Measure, heightPerEm: number): TextBoxLayout {
  const box = input.textBox;
  const make = (size: number): TextBoxLayout => layoutAtSize(input, size, measure, heightPerEm);
  const natural = make(input.sizeMm);
  if (box.mode !== 'fixed' || box.fit !== 'shrink' || !natural.overflow) return natural;
  const minimum = Math.min(input.sizeMm, box.minSizeMm);
  let best = make(minimum);
  if (best.overflow) return best;
  let low = minimum,
    high = input.sizeMm;
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const mid = (low + high) / 2;
    const candidate = make(mid);
    if (candidate.overflow) high = mid;
    else {
      low = mid;
      best = candidate;
    }
  }
  return best;
}

function layoutAtSize(
  input: Input,
  sizeMm: number,
  measure: Measure,
  heightPerEm: number,
): TextBoxLayout {
  const box = input.textBox;
  const lines = input.content
    .split('\n')
    .flatMap((line) =>
      box.mode !== 'auto-width' && box.wrap
        ? wrapLine(line, box.widthMm, (value) => measure(value, sizeMm))
        : [line],
    );
  const advanceWidthMm = lines.reduce((max, line) => Math.max(max, measure(line, sizeMm)), 0);
  const naturalHeight = Math.max(0, (lines.length - 1) * input.lineHeight + heightPerEm) * sizeMm;
  const widthMm = box.mode === 'auto-width' ? advanceWidthMm : box.widthMm;
  const heightMm = box.mode === 'fixed' ? box.heightMm : naturalHeight;
  return {
    content: lines.join('\n'),
    sizeMm,
    widthMm,
    heightMm,
    lineCount: lines.length,
    advanceWidthMm,
    overflow: advanceWidthMm > widthMm + 1e-7 || naturalHeight > heightMm + 1e-7,
  };
}

function wrapLine(line: string, width: number, measure: (text: string) => number): string[] {
  if (line === '') return [''];
  const lines: string[] = [];
  let current = '';
  for (const token of line.match(/\s+|\S+/gu) ?? []) {
    if (current !== '' && measure(current + token) > width && !/^\s+$/u.test(token)) {
      lines.push(current.trimEnd());
      current = '';
    }
    if (current === '' && /^\s+$/u.test(token) && lines.length > 0) continue;
    current += token;
    // Long words and CJK runs break at codepoint boundaries. Binary search
    // bounds measurement work and preserves supplementary-plane characters.
    while (measure(current) > width && Array.from(current).length > 1) {
      const characters = Array.from(current);
      const low = fittingPrefix(characters, width, measure);
      lines.push(characters.slice(0, low).join('').trimEnd());
      current = characters.slice(low).join('').trimStart();
    }
  }
  lines.push(current.trimEnd());
  return lines;
}

function fittingPrefix(
  characters: ReadonlyArray<string>,
  width: number,
  measure: (text: string) => number,
): number {
  let low = 1,
    high = characters.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(characters.slice(0, mid).join('')) <= width) low = mid;
    else high = mid - 1;
  }
  return low;
}
