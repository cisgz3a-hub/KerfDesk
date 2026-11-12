// The readiness note for a controller that reports no power scale (annoyance
// audit A2 B3-P2-1, ADR-095 Amendment 1): Marlin and Smoothieware are named
// and told what to check, the note stops once the operator has recorded that
// check, and nothing here ever becomes an error.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { createOperatorPowerScaleStatement } from '../devices/power-scale-statement';
import { DEFAULT_CNC_MACHINE_CONFIG, createProject } from '../scene';
import { runControllerReadiness } from './controller-readiness';

const MARLIN: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'marlin',
  gcodeDialect: { dialectId: 'marlin-inline' },
  maxPowerS: 255,
};
const SMOOTHIE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'smoothieware',
  maxPowerS: 1,
};

function stated(device: DeviceProfile): DeviceProfile {
  const statement = createOperatorPowerScaleStatement(device, '2026-11-11T10:00:00.000Z');
  return { ...device, operatorPowerScaleStatement: statement ?? undefined };
}

function notes(device: DeviceProfile, cnc = false) {
  const project = cnc
    ? { ...createProject(device), machine: DEFAULT_CNC_MACHINE_CONFIG }
    : createProject(device);
  return runControllerReadiness(project, null, 'none', device.controllerKind);
}

describe('a laser on a controller with no settings report', () => {
  it.each([
    ['Marlin', MARLIN, 'CUTTER_POWER_UNIT'],
    ['Smoothieware', SMOOTHIE, 'laser_module_maximum_s_value'],
  ])('%s is named and told what to check, without GRBL setting numbers', (name, device, key) => {
    const result = notes(device);
    expect(result).toMatchObject({ ok: true, errors: [] });
    expect(result.warnings.map((warning) => warning.code)).toEqual(['power-scale-unverified']);
    const message = result.warnings[0]?.message ?? '';
    expect(message).toContain(`${name} does not report its laser power scale`);
    expect(message).toContain(key);
    expect(message).toContain('I have checked this');
    expect(message).not.toMatch(/\$3[0-2]|GRBL/);
  });

  it.each([MARLIN, SMOOTHIE])(
    'says nothing once the operator has recorded the check ($controllerKind)',
    (device) => {
      expect(notes(stated(device))).toEqual({ ok: true, errors: [], warnings: [] });
    },
  );

  it('speaks again when the statement is for another Full-power S', () => {
    const result = notes({ ...stated(MARLIN), maxPowerS: 100 });
    expect(result.warnings.map((warning) => warning.code)).toEqual(['power-scale-unverified']);
  });

  it('keeps the general note for other families, now without "GRBL $-settings"', () => {
    const result = notes({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' });
    expect(result.warnings).toEqual([
      {
        code: 'power-scale-unverified',
        message:
          'This controller does not report its laser power scale, so the S power scale (max S 1000) comes from the device profile and is NOT verified against the firmware. Confirm it before burning at high power.',
      },
    ]);
  });
});

describe('a spindle on a controller with no settings report', () => {
  it('keeps its note whatever the laser statement says', () => {
    for (const device of [MARLIN, stated(MARLIN)]) {
      const result = notes(device, true);
      expect(result.ok).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.message).toMatch(
        /^This controller does not report its spindle speed scale, so the spindle S scale \(max RPM \d+\)/,
      );
    }
  });
});
