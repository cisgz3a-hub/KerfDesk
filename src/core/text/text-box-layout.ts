import type { TextBoxSettings } from '../scene/text-box';

export type TextBoxLayout = {
  readonly content: string;
  readonly sizeMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly lineCount: number;
  readonly advanceWidthMm: number;
  readonly overflow: boolean;
  /** Offsets in the original normalised content, preserving paragraph context
   * when one paragraph wraps into multiple visual lines. */
  readonly sourceStarts?: ReadonlyArray<number>;
};
type Input = {
  readonly content: string;
  readonly sizeMm: number;
  readonly lineHeight: number;
  readonly textBox: TextBoxSettings;
};
type Measure = (line: string, sizeMm: number, sourceStart: number) => number;
type BreakUnits = (text: string, sourceStart: number) => ReadonlyArray<string>;
type LayoutLine = { readonly text: string; readonly start: number };

/** Wrap using the chosen face's advances; never clip or delete source content. */
export function layoutTextBox(
  input: Input,
  measure: Measure,
  heightPerEm: number,
  breakUnits: BreakUnits = (text) => Array.from(text),
): TextBoxLayout {
  const box = input.textBox;
  const make = (size: number): TextBoxLayout =>
    layoutAtSize(input, size, measure, heightPerEm, breakUnits);
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
  breakUnits: BreakUnits,
): TextBoxLayout {
  const box = input.textBox;
  let offset = 0;
  const lines = input.content.split('\n').flatMap((text) => {
    const start = offset;
    offset += text.length + 1;
    return box.mode !== 'auto-width' && box.wrap
      ? wrapLine(
          text,
          start,
          box.widthMm,
          (value, sourceStart) => measure(value, sizeMm, sourceStart),
          breakUnits,
        )
      : [{ text, start }];
  });
  const advanceWidthMm = lines.reduce(
    (max, line) => Math.max(max, measure(line.text, sizeMm, line.start)),
    0,
  );
  const naturalHeight = Math.max(0, (lines.length - 1) * input.lineHeight + heightPerEm) * sizeMm;
  const widthMm = box.mode === 'auto-width' ? advanceWidthMm : box.widthMm;
  const heightMm = box.mode === 'fixed' ? box.heightMm : naturalHeight;
  return {
    content: lines.map((line) => line.text).join('\n'),
    sourceStarts: lines.map((line) => line.start),
    sizeMm,
    widthMm,
    heightMm,
    lineCount: lines.length,
    advanceWidthMm,
    overflow: advanceWidthMm > widthMm + 1e-7 || naturalHeight > heightMm + 1e-7,
  };
}

function wrapLine(
  line: string,
  start: number,
  width: number,
  measure: (text: string, sourceStart: number) => number,
  breakUnits: BreakUnits,
): LayoutLine[] {
  if (line === '') return [{ text: '', start }];
  const lines: LayoutLine[] = [];
  let current = '';
  let currentStart = start;
  for (const match of line.matchAll(/\s+|\S+/gu)) {
    const token = match[0];
    if (current !== '' && measure(current + token, currentStart) > width && !/^\s+$/u.test(token)) {
      lines.push({ text: current.trimEnd(), start: currentStart });
      current = '';
    }
    if (current === '' && /^\s+$/u.test(token) && lines.length > 0) continue;
    if (current === '') currentStart = start + match.index;
    current += token;
    // Complex text breaks only between shaping clusters, preserving combining
    // marks, supplementary characters and conjuncts. The Latin route retains
    // its existing codepoint policy.
    while (measure(current, currentStart) > width) {
      const characters = breakUnits(current, currentStart);
      if (characters.length <= 1) break;
      const low = fittingPrefix(characters, width, (value) => measure(value, currentStart));
      const prefix = characters.slice(0, low).join('');
      lines.push({ text: prefix.trimEnd(), start: currentStart });
      const remainder = characters.slice(low).join('');
      current = remainder.trimStart();
      currentStart += prefix.length + remainder.length - current.length;
    }
  }
  lines.push({ text: current.trimEnd(), start: currentStart });
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
