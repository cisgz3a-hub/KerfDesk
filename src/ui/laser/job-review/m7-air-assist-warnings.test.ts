import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { DeviceProfile } from '../../../core/devices';
import { detectM7AirAssistWarnings } from './m7-air-assist-warnings';

const M7_PROGRAM = 'G21\nG90\nM7\nM3 S0\nG1 X10 Y10 F1000\nM9\nM5\n';
const M8_PROGRAM = 'G21\nG90\nM8\nM3 S0\nG1 X10 Y10 F1000\nM9\nM5\n';

function deviceWithController(controllerKind: DeviceProfile['controllerKind']): DeviceProfile {
  return controllerKind === undefined
    ? DEFAULT_DEVICE_PROFILE
    : { ...DEFAULT_DEVICE_PROFILE, controllerKind };
}

describe('detectM7AirAssistWarnings', () => {
  it('warns when the program contains M7 and the controller is grbl-v1.1', () => {
    const warnings = detectM7AirAssistWarnings(M7_PROGRAM, deviceWithController('grbl-v1.1'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('M7');
    expect(warnings[0]).toContain('error:20');
  });

  it('warns when controllerKind is unset — the codebase-wide default is grbl-v1.1', () => {
    // The audited generic-grbl-400x400 profile carries no explicit
    // controllerKind; every resolver treats absent as 'grbl-v1.1'.
    expect(detectM7AirAssistWarnings(M7_PROGRAM, deviceWithController(undefined))).toHaveLength(1);
  });

  it('stays silent for controllers that support M7', () => {
    expect(detectM7AirAssistWarnings(M7_PROGRAM, deviceWithController('grblhal'))).toEqual([]);
    expect(detectM7AirAssistWarnings(M7_PROGRAM, deviceWithController('fluidnc'))).toEqual([]);
  });

  it('stays silent when the program has no M7', () => {
    expect(detectM7AirAssistWarnings(M8_PROGRAM, deviceWithController('grbl-v1.1'))).toEqual([]);
    expect(detectM7AirAssistWarnings('', deviceWithController('grbl-v1.1'))).toEqual([]);
  });

  it('does not mistake other words starting with M7 for the coolant command', () => {
    const program = 'G21\nM70\nG1 X5 F500\n';
    expect(detectM7AirAssistWarnings(program, deviceWithController('grbl-v1.1'))).toEqual([]);
  });
});
