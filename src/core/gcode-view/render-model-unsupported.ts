import type { UnsupportedWordCount } from './render-model-types';

export type UnsupportedWordMap = Map<string, { count: number; firstLine: number }>;

export function countUnsupported(map: UnsupportedWordMap, word: string, line: number): void {
  const existing = map.get(word);
  if (existing === undefined) map.set(word, { count: 1, firstLine: line });
  else existing.count += 1;
}

export function unsupportedList(
  map: ReadonlyMap<string, { count: number; firstLine: number }>,
): ReadonlyArray<UnsupportedWordCount> {
  return [...map.entries()].map(([word, entry]) => ({
    word,
    count: entry.count,
    firstLine: entry.firstLine,
  }));
}
