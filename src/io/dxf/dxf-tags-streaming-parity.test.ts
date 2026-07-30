// Streamed tokenizer ≡ materialized tokenizer (ADR-268).
//
// tokenizeDxf swapped index-based access over a fully split line array for a
// pull-based generator. That is exactly the kind of change that stays silent on
// the fixture corpus and then mis-numbers an error, drops the final tag, or
// mishandles a truncated file in the field. The reference below is the previous
// implementation verbatim; the property test pins the two indistinguishable,
// which is what makes the swap a non-change to behavior.
//
// Same discipline ADR-243 used to prove its row-streamed ditherer against the
// materialized one.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { tokenizeDxf, type TokenizeDxfResult } from './dxf-tags';

const GROUP_CODE_PATTERN = /^[+-]?\d+$/;
const BINARY_DXF_SENTINEL = 'AutoCAD Binary DXF';
const MAX_ECHO = 24;

// The pre-ADR-268 implementation, kept verbatim as the oracle.
function tokenizeDxfMaterialized(text: string): TokenizeDxfResult {
  if (text.startsWith(BINARY_DXF_SENTINEL)) {
    return { kind: 'error', reason: 'Binary DXF is not supported — re-export as ASCII DXF.' };
  }
  const lines = text.split(/\r\n|\n|\r/);
  const tags: { code: number; value: string }[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const codeLine = (lines[i] ?? '').trim();
    if (codeLine === '' && restIsBlank(lines, i)) break;
    if (!GROUP_CODE_PATTERN.test(codeLine)) {
      return {
        kind: 'error',
        reason: `Malformed DXF: expected an integer group code on line ${i + 1}, got "${truncate(codeLine)}".`,
      };
    }
    const value = lines[i + 1];
    if (value === undefined) {
      return {
        kind: 'error',
        reason: `Malformed DXF: group code on line ${i + 1} has no value line (truncated file).`,
      };
    }
    const code = Number.parseInt(codeLine, 10);
    tags.push({ code, value: value.trim() });
    if (code === 0 && value.trim() === 'EOF') break;
  }
  return { kind: 'ok', tags };
}

function restIsBlank(lines: ReadonlyArray<string>, from: number): boolean {
  for (let i = from; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim() !== '') return false;
  }
  return true;
}

function truncate(line: string): string {
  return line.length > MAX_ECHO ? `${line.slice(0, MAX_ECHO)}…` : line;
}

describe('tokenizeDxf streaming parity', () => {
  it.each([
    ['0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n', 'well-formed with EOF'],
    ['0\nSECTION\n', 'no EOF marker, trailing newline'],
    ['0\nSECTION', 'no EOF marker, no trailing newline'],
    ['0\nSECTION\n2\n', 'odd line count — truncated value'],
    ['0\nEOF\n0\nSECTION\n', 'content after EOF is ignored'],
    ['0\nSECTION\n\n\n\n', 'blank tail lines'],
    ['0\nSECTION\n\nnotacode\n', 'blank code line with non-blank rest'],
    ['bogus\nvalue\n', 'malformed group code on line 1'],
    ['0\r\nSECTION\r\n0\r\nEOF\r\n', 'CRLF'],
    ['0\rSECTION\r0\rEOF\r', 'bare CR'],
    ['', 'empty input'],
    ['\n', 'single newline'],
    ['  10  \n  1.5  \n0\nEOF\n', 'surrounding whitespace is trimmed'],
    ['-5\nvalue\n0\nEOF\n', 'negative group code'],
    ['AutoCAD Binary DXF\x00', 'binary sentinel'],
  ])('matches the materialized tokenizer for %j (%s)', (text) => {
    expect(tokenizeDxf(text)).toEqual(tokenizeDxfMaterialized(text));
  });

  it('matches the materialized tokenizer over arbitrary DXF-shaped text', () => {
    const dxfish = fc.stringOf(
      fc.constantFrom('0\n', 'EOF\n', 'SECTION\n', '10\n', '1.5\n', '\n', '\r\n', '\r', ' ', 'x'),
      { maxLength: 40 },
    );
    fc.assert(
      fc.property(dxfish, (text) => {
        expect(tokenizeDxf(text)).toEqual(tokenizeDxfMaterialized(text));
      }),
      { numRuns: 1000 },
    );
  });

  it('matches the materialized tokenizer over unconstrained strings', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(tokenizeDxf(text)).toEqual(tokenizeDxfMaterialized(text));
      }),
      { numRuns: 500 },
    );
  });
});
