// Which alarms keep the machine position, per firmware (ADR-367 Amendment 3).
// The oracle is each firmware's own source, cited in alarm-position-kept.ts,
// not the tables under test: a code moves into a "kept" list here only with a
// source that shows a controlled stop.
import { describe, expect, it } from 'vitest';
import type { ControllerKind } from '../../devices';
import { alarmKeepsMachinePosition } from './alarm-position-kept';

const CODES = Array.from({ length: 30 }, (_, index) => index);

function keptCodes(kind: ControllerKind): ReadonlyArray<number> {
  return CODES.filter((code) => alarmKeepsMachinePosition(kind, code));
}

describe('alarmKeepsMachinePosition', () => {
  it('stock GRBL keeps position through a soft limit and a failed probe only', () => {
    expect(keptCodes('grbl-v1.1')).toEqual([2, 4, 5]);
  });

  // 13, probe protection, was marked position-kept; grblHAL marks the position
  // lost when the probe input trips while the motors are stepping.
  it('grblHAL keeps position through a soft limit and a failed probe only', () => {
    expect(keptCodes('grblhal')).toEqual([2, 4, 5]);
  });

  it('FluidNC also keeps it through a G-code error in its own job (17)', () => {
    expect(keptCodes('fluidnc')).toEqual([2, 4, 5, 17]);
  });

  it.each([
    ['a hard limit', 1],
    ['a reset during motion', 3],
    ['a failed homing cycle', 9],
  ])('no GRBL-family firmware keeps it through %s', (_name, code) => {
    for (const kind of ['grbl-v1.1', 'grblhal', 'fluidnc'] as const) {
      expect(alarmKeepsMachinePosition(kind, code)).toBe(false);
    }
  });

  // The power-on lock of a machine that must home: the reported number is not
  // a measured position (grblHAL ALARM:11, FluidNC ALARM:14).
  it('the homing-required lock is not position-kept', () => {
    expect(alarmKeepsMachinePosition('grblhal', 11)).toBe(false);
    expect(alarmKeepsMachinePosition('fluidnc', 14)).toBe(false);
  });

  it('a code no table lists is not position-kept', () => {
    expect(alarmKeepsMachinePosition('grbl-v1.1', 99)).toBe(false);
    expect(alarmKeepsMachinePosition('fluidnc', 0)).toBe(false);
  });

  it.each(['marlin', 'smoothieware', 'ruida'] as const)(
    '%s raises no numbered GRBL alarm, so nothing is position-kept',
    (kind) => {
      expect(keptCodes(kind)).toEqual([]);
    },
  );
});
