import type { Bidi } from 'bidi-js';
import { UNICODE_SCRIPT_RANGES } from './unicode-script-ranges';
import { UNICODE_SCRIPT_EXTENSION_RANGES } from './unicode-script-extensions';

type Range = { readonly start: number; readonly end: number; readonly scripts: string[] };
type ScriptCharacter = { readonly text: string; readonly level: number };
const scripts = decodeRanges(UNICODE_SCRIPT_RANGES);
const extensions = decodeRanges(UNICODE_SCRIPT_EXTENSION_RANGES);
const contextual = new Set(['Zyyy', 'Zinh', 'Zzzz']);

/** UAX #24 script itemisation: marks inherit, common characters borrow context,
 * Script_Extensions prefers a compatible neighbour, paired brackets agree. */
export function textScripts(characters: ReadonlyArray<ScriptCharacter>, bidi: Bidi): string[] {
  const candidates = characters.map(({ text }) => scriptCandidates(text));
  const next = nextStrongScripts(characters, candidates);
  const previous = new Map<number, string>();
  const resolved = characters.map((character, index) => {
    const options = candidates[index] ?? [];
    const before = previous.get(character.level);
    const after = next[index];
    const inherited =
      /\p{M}/u.test(character.text) || character.text === '\u200c' || character.text === '\u200d';
    const selected =
      inherited && before !== undefined
        ? before
        : (compatible(before, options) ?? compatible(after, options) ?? options[0] ?? 'Latn');
    if (options.length > 0 && !inherited) previous.set(character.level, selected);
    return selected;
  });
  const brackets: { closing: string; script: string; level: number }[] = [];
  characters.forEach((character, index) => {
    const closing = bidi.openingToClosingBracket(character.text);
    if (closing !== null) {
      brackets.push({ closing, script: resolved[index] ?? 'Latn', level: character.level });
    } else if (bidi.closingToOpeningBracket(character.text) !== null) {
      let match = brackets.length - 1;
      while (
        match >= 0 &&
        (brackets[match]?.closing !== character.text || brackets[match]?.level !== character.level)
      )
        match -= 1;
      if (match >= 0) {
        resolved[index] = brackets[match]?.script ?? 'Latn';
        brackets.length = match;
      }
    }
  });
  return resolved;
}

function nextStrongScripts(
  characters: ReadonlyArray<ScriptCharacter>,
  candidates: ReadonlyArray<ReadonlyArray<string>>,
): (string | undefined)[] {
  const next = new Map<number, string>();
  const result: (string | undefined)[] = new Array(characters.length);
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index];
    if (character === undefined) continue;
    result[index] = next.get(character.level);
    const options = candidates[index] ?? [];
    if (options.length === 1 && !/\p{M}/u.test(character.text)) {
      next.set(character.level, options[0] as string);
    }
  }
  return result;
}

function compatible(
  script: string | undefined,
  options: ReadonlyArray<string>,
): string | undefined {
  return script !== undefined && (options.length === 0 || options.includes(script))
    ? script
    : undefined;
}

function scriptCandidates(character: string): string[] {
  const codepoint = character.codePointAt(0) ?? 0;
  const values = lookup(extensions, codepoint) ?? lookup(scripts, codepoint) ?? [];
  return values.filter((value) => !contextual.has(value));
}

function decodeRanges(data: Readonly<Record<string, string>>): Range[] {
  return Object.entries(data)
    .flatMap(([tags, encoded]) =>
      encoded.split(',').map((range) => {
        const [from = '0', to = from] = range.split('-');
        return {
          start: Number.parseInt(from, 16),
          end: Number.parseInt(to, 16),
          scripts: tags.split(' '),
        };
      }),
    )
    .sort((a, b) => a.start - b.start);
}

function lookup(ranges: ReadonlyArray<Range>, codepoint: number): string[] | undefined {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle];
    if (range === undefined) break;
    if (codepoint < range.start) high = middle - 1;
    else if (codepoint > range.end) low = middle + 1;
    else return range.scripts;
  }
  return undefined;
}
