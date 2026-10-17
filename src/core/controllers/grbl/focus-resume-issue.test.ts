import { describe, expect, it } from 'vitest';
import { buildResumeProgram } from './resume-program';

const options = {
  machineKind: 'laser' as const,
  safeZMm: 0,
  spindleSpinupSec: 0,
  plungeMmPerMin: 300,
};
const marker = '; Focus Test Z offset 1.000 mm from starting focus';
const burn = 'G90\nM4 S0\nG0 X0 Y0\nG1 X10 Y0 F300 S20\nM5';

describe('core Focus artifact resume guard', () => {
  it.each(['G91\nG1 Z1 F300 S0', 'G91 G1 Z-.001 F300 S0', 'G1 F300 S0\nG91\nZ+1'])(
    'refuses actual displacement from every restart boundary: %s',
    (move) => {
      const source = `${marker}\n${move}\n${burn}\nG91\nG1 Z-1 F300 S0\nG90\nM5`;
      for (const line of [1, 3, source.split('\n').length]) {
        expect(buildResumeProgram(source, line, options)).toMatchObject({
          kind: 'error',
          reason: expect.stringContaining('original starting Z focus'),
        });
      }
    },
  );

  it.each(['', 'G91\nG1 Z0 F300 S0\nG90', '; G91 G1 Z1\n(G91 G1 Z1)', 'G90\nG1 Z1 F300 S0'])(
    'does not treat markers, comments or non-relative motion as displaced Focus: %s',
    (prefix) => {
      expect(buildResumeProgram(`${marker}\n${prefix}\n${burn}`, 1, options).kind).toBe('ok');
    },
  );

  it('leaves ordinary relative-motion programs under their existing resume rules', () => {
    expect(buildResumeProgram(`G91\nG1 Z1 F300 S0\n${burn}`, 1, options).kind).toBe('ok');
  });
});
