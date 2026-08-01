import { describe, expect, it } from 'vitest';
import { SaxesParser } from 'saxes';
import { RawOpenTagScanner } from './raw-open-tag-scanner';

// XML 1.0 NameStartChar allows #x10000-#xEFFFF, so an element name can begin with
// a character that is two UTF-16 code units wide.
const ASTRAL_NAME = '\u{20000}';

const MUTANT_COUNT = 8000;
const MUTATION_SEED = 20260801;
const MAX_EDITS_PER_MUTANT = 3;
const MAX_REPORTED_FAILURES = 5;

const MUTATION_BASE = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY e "v"><!-- c --><?pi x?>]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!-- note --><![CDATA[raw <g/>]]><?proc go?><g id="a"><path d="M0 0 L9 9" stroke="red"/></g><text a='>'>hi &amp; bye</text></svg>`;

const MUTATION_ALPHABET = [...`<>!-?[]"'/&;abc \n\t=CDATAxml`];

describe('RawOpenTagScanner', () => {
  it('ignores declarations, comments, CDATA, processing instructions, and closing tags', () => {
    const scanner = new RawOpenTagScanner();
    const source = `<?xml version="1.0"?>
      <!DOCTYPE svg [
        <!ELEMENT svg ANY>
        <!-- declaration <noise/> -->
        <?declaration instruction?>
      ]>
      <svg data-note="a>b">
        <!-- <comment-noise/> -->
        <![CDATA[<cdata-noise/>]]>
        <?inside instruction?>
        <g/><path data-note='c>d'/>
      </svg>`;

    for (const character of source) scanner.write(character);

    expect(scanner.take()).toBe('<svg data-note="a>b">');
    expect(scanner.take()).toBe('<g/>');
    expect(scanner.take()).toBe("<path data-note='c>d'/>");
    // Rule 7: a drained scanner reports "nothing left", it never refuses the import.
    expect(scanner.take()).toBeNull();
  });

  it('retains complete tags when markup delimiters cross writes', () => {
    const scanner = new RawOpenTagScanner();
    const source = '<svg><!--ignored--><![CDATA[ignored]]><path d="M0 0 L1 1"/></svg>';

    for (let index = 0; index < source.length; index += 2) {
      scanner.write(source.slice(index, index + 2));
    }

    expect(scanner.take()).toBe('<svg>');
    expect(scanner.take()).toBe('<path d="M0 0 L1 1"/>');
  });

  it('tokenizes an element whose name starts with an astral code point', () => {
    const source = `<svg viewBox="0 0 10 10"><${ASTRAL_NAME}/><path d="M0 0 L9 9"/></svg>`;

    expect(scanTags(source)).toEqual([
      '<svg viewBox="0 0 10 10">',
      `<${ASTRAL_NAME}/>`,
      '<path d="M0 0 L9 9"/>',
    ]);
    expect(scanTagNames(source)).toEqual(saxesOpenTagNames(source));
  });

  it.each([
    ['nested brackets in the internal subset', '<!DOCTYPE svg [<!ENTITY[e "v">]>'],
    ['a quote directly after the subset open waka', '<!DOCTYPE svg [<"ENTITY e "v">]>'],
    ['a bare open waka in the internal subset', '<!DOCTYPE svg [<[pi x?>]>'],
    ['a greater-than inside the internal subset', '<!DOCTYPE svg [<!ENTITY e "v">>]>'],
    ['a greater-than inside a doctype literal', '<!DOCTYPE svg SYSTEM "a>b.dtd">'],
    ['a subset comment holding markup', '<!DOCTYPE svg [<!-- <g/> -->]>'],
    ['a subset instruction holding markup', '<!DOCTYPE svg [<?pi <g/> ?>]>'],
  ])('stays in step with saxes across %s', (_label, doctype) => {
    const source = `${doctype}<svg><path d="M0 0 L1 1"/></svg>`;

    expect(scanTagNames(source)).toEqual(saxesOpenTagNames(source));
  });

  it('produces the same tags however the source is chunked', () => {
    const source = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY e "v"><!-- c --><?pi x?>]><svg><!-- n --><![CDATA[<g/>]]><${ASTRAL_NAME}/><path d="M0 0"/></svg>`;
    const characters = [...source];
    const expected = scanTags(source);

    for (let split = 0; split <= characters.length; split += 1) {
      const scanner = new RawOpenTagScanner();
      scanner.write(characters.slice(0, split).join(''));
      scanner.write(characters.slice(split).join(''));
      expect(drain(scanner)).toEqual(expected);
    }
  });

  it('matches the saxes open-tag stream across well-formed mutants', () => {
    const random = mulberry32(MUTATION_SEED);
    const failures: string[] = [];
    let accepted = 0;

    for (let index = 0; index < MUTANT_COUNT; index += 1) {
      const source = mutate(MUTATION_BASE, random);
      let expected: readonly string[];
      try {
        expected = saxesOpenTagNames(source);
      } catch {
        continue;
      }
      accepted += 1;
      const actual = scanTagNames(source);
      if (!isSameNameStream(actual, expected) && failures.length < MAX_REPORTED_FAILURES) {
        failures.push(
          `${JSON.stringify(source)} saxes=${expected.length} scanner=${actual.length}`,
        );
      }
    }

    expect(accepted).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });
});

function drain(scanner: RawOpenTagScanner): string[] {
  const tags: string[] = [];
  for (let raw = scanner.take(); raw !== null; raw = scanner.take()) tags.push(raw);
  return tags;
}

function scanTags(source: string): string[] {
  const scanner = new RawOpenTagScanner();
  scanner.write(source);
  return drain(scanner);
}

function scanTagNames(source: string): string[] {
  return scanTags(source).map((raw) => /^<([^\s/>]+)/u.exec(raw)?.[1] ?? '');
}

function isSameNameStream(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((name, at) => name === expected[at]);
}

function saxesOpenTagNames(source: string): string[] {
  const names: string[] = [];
  const parser = new SaxesParser();
  parser.on('opentag', (tag) => names.push(tag.name));
  parser.write(source).close();
  return names;
}

function mutate(base: string, random: () => number): string {
  const characters = [...base];
  const edits = 1 + Math.floor(random() * MAX_EDITS_PER_MUTANT);
  for (let index = 0; index < edits; index += 1) {
    const at = Math.floor(random() * characters.length);
    const roll = random();
    const replacement = MUTATION_ALPHABET[Math.floor(random() * MUTATION_ALPHABET.length)] ?? 'a';
    if (roll < 0.4) characters[at] = replacement;
    else if (roll < 0.7) characters.splice(at, 0, replacement);
    else characters.splice(at, 1);
  }
  return characters.join('');
}

// Seeded PRNG so a mutant that ever desynchronises the scanner stays reproducible.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
