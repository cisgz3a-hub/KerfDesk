import { describe, expect, it } from 'vitest';
import { FLUIDNC_MAX_LINE_CHARS, findFluidncOverlongLines } from './fluidnc-line-limit';

function lineOf(length: number): string {
  return 'G1 X'.padEnd(length, '0');
}

describe('findFluidncOverlongLines', () => {
  it('uses the 254 retained characters FluidNC keeps per line', () => {
    expect(FLUIDNC_MAX_LINE_CHARS).toBe(254);
  });

  it('stays silent for an empty program and for lines at the limit', () => {
    expect(findFluidncOverlongLines('')).toEqual([]);
    expect(findFluidncOverlongLines('G21\nG90\nM5\n')).toEqual([]);
    expect(findFluidncOverlongLines(`${lineOf(FLUIDNC_MAX_LINE_CHARS)}\n`)).toEqual([]);
  });

  it('reports the first character past the limit, where truncation starts', () => {
    const overlong = findFluidncOverlongLines(`${lineOf(FLUIDNC_MAX_LINE_CHARS + 1)}\n`);
    expect(overlong).toEqual([{ lineNumber: 1, length: FLUIDNC_MAX_LINE_CHARS + 1 }]);
  });

  it('numbers offending lines from 1 within the emitted program', () => {
    const gcode = `G21\n${lineOf(300)}\nG90\n${lineOf(260)}\n`;
    expect(findFluidncOverlongLines(gcode)).toEqual([
      { lineNumber: 2, length: 300 },
      { lineNumber: 4, length: 260 },
    ]);
  });

  it('excludes the line terminator, which completes the line instead of being stored', () => {
    // A CRLF program carries a trailing '\r' on every split line. FluidNC
    // completes the line on '\r' rather than storing it, so a line whose
    // payload is exactly at the limit must not be reported.
    expect(findFluidncOverlongLines(`${lineOf(FLUIDNC_MAX_LINE_CHARS)}\r\n`)).toEqual([]);
    expect(findFluidncOverlongLines(`${lineOf(FLUIDNC_MAX_LINE_CHARS + 1)}\r\n`)).toEqual([
      { lineNumber: 1, length: FLUIDNC_MAX_LINE_CHARS + 1 },
    ]);
  });

  it('reports a trailing unterminated line', () => {
    expect(findFluidncOverlongLines(lineOf(400))).toEqual([{ lineNumber: 1, length: 400 }]);
  });
});
