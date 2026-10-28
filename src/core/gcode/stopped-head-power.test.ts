import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { Job } from '../job';
import { grblStrategy } from '../output/grbl-strategy';
import { marlinStrategy } from '../output/marlin-strategy';
import { findStoppedHeadPower } from './stopped-head-power';

const CUT: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 80,
      speed: 1500,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

function grbl(dialectId: 'grbl-compatible' | 'grbl-dynamic'): string {
  return grblStrategy.emit(CUT, { ...DEFAULT_DEVICE_PROFILE, gcodeDialect: { dialectId } });
}

function marlin(dialectId: 'marlin-inline' | 'marlin-fan'): string {
  const device: DeviceProfile = {
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind: 'marlin',
    maxPowerS: 255,
    gcodeDialect: { dialectId },
  };
  return marlinStrategy.emit(CUT, device);
}

describe('findStoppedHeadPower (rolling audit v6 K1, ADR-676)', () => {
  it('finds the constant-power cut GRBL Compatible emits', () => {
    expect(findStoppedHeadPower(grbl('grbl-compatible'), 'grbl')?.kind).toBe('grbl-constant');
  });

  it('finds nothing in GRBL Dynamic output, which goes dark at a stop', () => {
    expect(findStoppedHeadPower(grbl('grbl-dynamic'), 'grbl')).toBeNull();
  });

  it('finds the inline cutter in the default Marlin output', () => {
    expect(findStoppedHeadPower(marlin('marlin-inline'), 'marlin')?.kind).toBe('marlin-cutter');
  });

  it('finds the fan output in Marlin fan-dialect output', () => {
    expect(findStoppedHeadPower(marlin('marlin-fan'), 'marlin')?.kind).toBe('marlin-fan');
  });

  it('names the first lit move under GRBL M3', () => {
    const program = ['G21 G90', 'M3 S0', 'G0 X1 Y1', 'G1 X2 S0', 'G1 X3 S800', 'M5'].join('\n');
    expect(findStoppedHeadPower(program, 'grbl')).toEqual({ kind: 'grbl-constant', line: 5 });
  });

  it('ignores M3 used only for rapids or at zero power, and M3 after M30', () => {
    expect(findStoppedHeadPower('M3 S800\nG0 X5\nM5\n', 'grbl')).toBeNull();
    expect(findStoppedHeadPower('M3 S0\nG1 X5 F600\nM5\n', 'grbl')).toBeNull();
    expect(findStoppedHeadPower('M4 S800\nG1 X5 F600\nM30\nG1 X6\n', 'grbl')).toBeNull();
  });

  it('reads M3 in a comment as nothing', () => {
    expect(findStoppedHeadPower('; M3 S800\nM4 S800\nG1 X5 F600\n', 'grbl')).toBeNull();
  });

  it("leaves Marlin's dynamic inline mode, which blanks at a stop, unflagged", () => {
    expect(findStoppedHeadPower('M4 I S0\nG1 X5 S200 F600\nM5 I\n', 'marlin')).toBeNull();
  });

  it('flags a Marlin fan that a travel move carries', () => {
    expect(findStoppedHeadPower('M106 S120\nG0 X5\nM107\n', 'marlin')).toEqual({
      kind: 'marlin-fan',
      line: 2,
    });
  });
});
