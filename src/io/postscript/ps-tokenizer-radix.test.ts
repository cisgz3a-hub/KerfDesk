import { describe, expect, it } from 'vitest';
import { PsTokenizer } from './ps-tokenizer';

function first(text: string) {
  return new PsTokenizer(text, () => null).next();
}

// Oracle audit O8-P3-3: parseInt read the valid prefix of a radix number, so
// `8#19` became 1 and `2#102` became 2. PLRM §3.2.2: every digit must be below
// the base, otherwise the token is not a number.
describe('PsTokenizer radix numbers', () => {
  it.each([
    ['16#FF', 255],
    ['8#17', 15],
    ['2#101', 5],
    ['36#Z', 35],
  ])('reads %s as %d', (text, value) => {
    expect(first(text)).toBe(value);
  });

  it.each(['8#19', '2#102', '10#1A'])('does not read %s as a number', (text) => {
    expect(typeof first(text)).not.toBe('number');
  });
});
