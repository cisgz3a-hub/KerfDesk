import { describe, expect, it } from 'vitest';
import { iterateLines } from '../../core/util';
import { createGcodeProgramLineParser } from './gcode-program-line-parser';
import { parseGcodeProgram } from './parse-gcode-program';

describe('createGcodeProgramLineParser', () => {
  it('is exactly equivalent to the synchronous parser', () => {
    const text = [
      'G21 G90',
      'G0 X2 Y3',
      'G1 Z-1',
      'G1 X10 Y3 F200',
      'G2 X12 Y5 I0 J2',
      'G91',
      'G1 X1 Y1',
      'M2',
      'G1 X999',
      '',
    ].join('\r\n');
    const parser = createGcodeProgramLineParser();

    for (const line of iterateLines(text)) parser.pushLine(line);

    expect(parser.finish()).toEqual(parseGcodeProgram(text));
  });

  it('retains validation errors and line numbers across incremental pushes', () => {
    const parser = createGcodeProgramLineParser();
    parser.pushLine('G90');
    parser.pushLine('G18');
    parser.pushLine('G2 X10 Z0 I5 K0');

    expect(parser.finish()).toEqual({
      kind: 'error',
      reason: 'Line 2: G18 plane arcs are not supported (XY/G17 only).',
    });
  });
});
