import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';

describe('DEFAULT_DEVICE_PROFILE', () => {
  it('matches the WORKFLOW.md F-A1 first-run defaults exactly', () => {
    expect(DEFAULT_DEVICE_PROFILE).toMatchObject({
      name: 'Default 400×400',
      bedWidth: 400,
      bedHeight: 400,
      maxFeed: 6000,
      maxPowerS: 1000,
      minPowerS: 0,
      laserModeEnabled: true,
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

  it('defaults air assist command to none so output is unchanged until configured', () => {
    expect(DEFAULT_DEVICE_PROFILE.airAssistCommand).toBe('none');
  });

  it('uses a narrow air assist command enum', () => {
    const valid: ReadonlyArray<DeviceProfile['airAssistCommand']> = ['none', 'M7', 'M8'];
    expect(valid).toContain(DEFAULT_DEVICE_PROFILE.airAssistCommand);
  });

  it('is shaped so the workspace can be derived (bed* are positive numbers)', () => {
    expect(DEFAULT_DEVICE_PROFILE.bedWidth).toBeGreaterThan(0);
    expect(DEFAULT_DEVICE_PROFILE.bedHeight).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_DEVICE_PROFILE.maxFeed)).toBe(true);
    expect(Number.isInteger(DEFAULT_DEVICE_PROFILE.maxPowerS)).toBe(true);
    expect(Number.isInteger(DEFAULT_DEVICE_PROFILE.minPowerS)).toBe(true);
    expect(DEFAULT_DEVICE_PROFILE.laserModeEnabled).toBe(true);
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

  it('planner defaults are present and sit in the GRBL-typical range', () => {
    // Accel: real machines run roughly 100-2500 mm/s². Junction
    // deviation: grbl ships 0.010, common range 0.001-0.05.
    expect(DEFAULT_DEVICE_PROFILE.accelMmPerSec2).toBeGreaterThanOrEqual(100);
    expect(DEFAULT_DEVICE_PROFILE.accelMmPerSec2).toBeLessThanOrEqual(5000);
    expect(DEFAULT_DEVICE_PROFILE.junctionDeviationMm).toBeGreaterThan(0);
    expect(DEFAULT_DEVICE_PROFILE.junctionDeviationMm).toBeLessThan(0.1);
  });

  it('framing feed defaults to a safe diode-laser jog rate (LightBurn parity)', () => {
    // 6000 mm/min matches LightBurn's default frame speed and runs
    // reliably on the Falcon / xTool diode-laser class. Anything below
    // 1000 mm/min would make framing painfully slow; anything above
    // the typical max rate (~15000) would skip steps on most diode
    // gantries.
    expect(DEFAULT_DEVICE_PROFILE.framingFeedMmPerMin).toBeGreaterThanOrEqual(1000);
    expect(DEFAULT_DEVICE_PROFILE.framingFeedMmPerMin).toBeLessThanOrEqual(15000);
  });
});
