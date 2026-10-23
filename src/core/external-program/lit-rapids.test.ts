import { describe, expect, it } from 'vitest';
import {
  executeGrblLine,
  powerUpGrbl,
} from '../../__fixtures__/controllers/grbl-laser-power-model';
import { scanModalMotionLine } from '../gcode/modal-motion-line';
import { findLitRapids } from './lit-rapids';
import { normalizeExternalProgram } from './normalize-external-program';

// The G0 moves the GRBL power oracle (a port of gnea gcode.c) runs lit, one
// line at a time, from power-up.
function oracleLitRapidLines(gcode: string, laserMode: boolean): ReadonlyArray<number> {
  const model = powerUpGrbl(laserMode);
  const lit: number[] = [];
  gcode.split('\n').forEach((line, index) => {
    executeGrblLine(model, line);
    const moves = scanModalMotionLine(line, 0).isMotion;
    if (moves && model.motion === 'G0' && model.beam > 0) lit.push(index + 1);
  });
  return lit;
}

function sent(source: string): string {
  const program = normalizeExternalProgram(source);
  if (program.kind !== 'ok') throw new Error('not sendable');
  return program.program.gcode;
}

// LightBurn-style output: power on the cuts, none on the moves between them.
const UNGUARDED = sent(
  ['G0 X5 Y5', 'M4', 'G1 X10 Y10 S800 F1000', 'G0 X10 Y40', 'G1 X40 Y40', 'G0 X0 Y0', 'M5'].join(
    '\n',
  ),
);

describe('findLitRapids (ADR-630 Amendment 4)', () => {
  it('finds the G0 moves GRBL runs lit with laser mode off', () => {
    expect(findLitRapids(UNGUARDED)).toEqual({ count: 2, firstLine: 5 });
    expect(oracleLitRapidLines(UNGUARDED, false)).toEqual([5, 7]);
    // In laser mode GRBL keeps every G0 dark.
    expect(oracleLitRapidLines(UNGUARDED, true)).toEqual([]);
  });

  it('is quiet when every G0 carries S0, follows M5 or runs after a program end', () => {
    const guarded = sent(
      [
        'M4 S800',
        'G0 X5 Y5 S0',
        'G1 X10 S800 F1000',
        'G0 X20 S0',
        'G1 X30 S800',
        'M5',
        'G0 X0 Y0',
        'M3 S500',
        'G1 X1 F600',
        'M30',
        'G0 X2',
        // M30 also put GRBL back in G1, so this is a cut, not a rapid.
        'M30',
        'M3 S500',
        'X3',
      ].join('\n'),
    );
    expect(findLitRapids(guarded)).toBeNull();
    expect(oracleLitRapidLines(guarded, false)).toEqual([]);
  });

  it('reads modal G0 lines, S set on the move and M3 on the move', () => {
    const program = sent(
      ['S300', 'G0 X1', 'X2', 'M3', 'G0 X3 S0', 'X4 S200', 'G0 X5 M3'].join('\n'),
    );
    expect(findLitRapids(program)).toEqual({ count: 2, firstLine: 7 });
    expect(oracleLitRapidLines(program, false)).toEqual([7, 8]);
  });

  it('counts an M3 before any S, whose power the controller kept from before', () => {
    const program = sent(['M3', 'G0 X10', 'M5'].join('\n'));
    expect(findLitRapids(program)).toEqual({ count: 1, firstLine: 3 });
  });

  it.each(['G28', 'G30', 'G28 X0', 'G30 Z0'])(
    'warns for a lit stored-position return %s, even with no axis words',
    (command) => {
      expect(findLitRapids(`G1 F100\nM3 S200\n${command}\nX10`)).toEqual({
        count: 1,
        firstLine: 3,
        storedPositionReturns: { count: 1, firstLine: 3 },
      });
    },
  );

  it('does not count stored-position setters or laser-off returns', () => {
    expect(findLitRapids('M3 S200\nG28.1\nG30.1\nG28 S0\nM5\nG30')).toBeNull();
  });

  it('applies power before a return and program end after it', () => {
    expect(findLitRapids('G30 M3 S200 M2\nG28')).toEqual({
      count: 1,
      firstLine: 1,
      storedPositionReturns: { count: 1, firstLine: 1 },
    });
  });

  it('is quiet with the laser never on', () => {
    expect(findLitRapids(sent('G0 X10 Y10\nG1 X20 S0 F600\nG0 X0 Y0'))).toBeNull();
  });
});
