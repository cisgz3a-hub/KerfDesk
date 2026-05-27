import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from './device-profile';

describe('DEFAULT_DEVICE_PROFILE', () => {
  it('matches the WORKFLOW.md F-A1 first-run defaults exactly', () => {
    expect(DEFAULT_DEVICE_PROFILE).toMatchObject({
      name: 'Default 400×400',
      bedWidth: 400,
      bedHeight: 400,
      maxFeed: 6000,
      maxPowerS: 1000,
      origin: 'front-left',
      homing: { enabled: false, direction: 'front-left' },
    });
  });

  it('ships an empty autofocus command — no portable default exists', () => {
    // Field finding: every "reasonable default" we tried broke at least one
    // common machine (G38.2 → error:20 on GrblHAL diode lasers; vendor
    // M-codes are mutually exclusive). The Auto-focus button stays disabled
    // until the user pastes their machine's actual command — see the
    // DeviceProfile docs and the UI hint in DeviceSettings for context.
    expect(DEFAULT_DEVICE_PROFILE.autofocusCommand).toBe('');
  });

  it('is shaped so the workspace can be derived (bed* are positive numbers)', () => {
    expect(DEFAULT_DEVICE_PROFILE.bedWidth).toBeGreaterThan(0);
    expect(DEFAULT_DEVICE_PROFILE.bedHeight).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_DEVICE_PROFILE.maxFeed)).toBe(true);
    expect(Number.isInteger(DEFAULT_DEVICE_PROFILE.maxPowerS)).toBe(true);
  });

  it('bed dimensions sit in the millimetre range, not centimetre or inch', () => {
    // Audit guard: catches a future regression where someone types 40
    // (cm) or 16 (in) thinking it'll be auto-converted. A 400 mm bed is
    // canonical for the Falcon A1 Pro and other common 40-cm-class
    // machines — anything below 100 mm is almost certainly a unit
    // confusion, not a real machine. Real laser CAM beds run roughly
    // 100 mm (xTool M1) to 1500 mm (Lightburn-class CO₂).
    expect(DEFAULT_DEVICE_PROFILE.bedWidth).toBeGreaterThanOrEqual(100);
    expect(DEFAULT_DEVICE_PROFILE.bedWidth).toBeLessThanOrEqual(1500);
    expect(DEFAULT_DEVICE_PROFILE.bedHeight).toBeGreaterThanOrEqual(100);
    expect(DEFAULT_DEVICE_PROFILE.bedHeight).toBeLessThanOrEqual(1500);
  });
});
