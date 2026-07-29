import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { iterateLines } from './iterate-lines';

const split = (text: string): string[] => text.split(/\r\n|\n|\r/);

describe('iterateLines', () => {
  it.each([
    ['', 'empty input'],
    ['one', 'no break'],
    ['a\nb', 'LF'],
    ['a\r\nb', 'CRLF'],
    ['a\rb', 'bare CR'],
    ['a\n', 'trailing LF yields a final empty line'],
    ['a\r\n', 'trailing CRLF yields a final empty line'],
    ['\n\n\n', 'consecutive breaks'],
    ['a\r\n\r\nb', 'blank line between CRLF breaks'],
    ['a\n\rb', 'LF then bare CR are two breaks'],
  ])('matches split() for %j (%s)', (text) => {
    expect([...iterateLines(text)]).toEqual(split(text));
  });

  // The swap into the G-code and DXF parsers is only safe if the two are
  // indistinguishable, so pin it over arbitrary break-heavy text.
  it('is indistinguishable from split() over arbitrary text', () => {
    const lineBreakHeavy = fc.stringOf(
      fc.constantFrom('a', 'b', ' ', '\n', '\r', '\r\n', 'G1', ';x'),
      { maxLength: 60 },
    );
    fc.assert(
      fc.property(lineBreakHeavy, (text) => {
        expect([...iterateLines(text)]).toEqual(split(text));
      }),
      { numRuns: 500 },
    );
  });

  it('is indistinguishable from split() over unconstrained strings', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect([...iterateLines(text)]).toEqual(split(text));
      }),
      { numRuns: 500 },
    );
  });
});
