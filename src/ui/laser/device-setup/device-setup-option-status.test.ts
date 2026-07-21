import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../../core/devices';
import {
  autofocusStatus,
  cameraStatus,
  noGoZoneStatus,
  plannerStatus,
  rotaryStatus,
  scanOffsetStatus,
  zAxisStatus,
} from './device-setup-option-status';

const BASE = DEFAULT_DEVICE_PROFILE;

function withPatch(patch: Partial<DeviceProfile>): DeviceProfile {
  return { ...BASE, ...patch };
}

describe('device-setup option status summaries', () => {
  it('summarizes no-go zones with enabled counts', () => {
    expect(noGoZoneStatus(withPatch({ noGoZones: [] }))).toBe('None configured');
    const zone = { id: 'z1', name: 'Clamp', enabled: true, x: 0, y: 0, width: 20, height: 20 };
    expect(noGoZoneStatus(withPatch({ noGoZones: [zone] }))).toBe('1 zone (1 enabled)');
    expect(
      noGoZoneStatus(withPatch({ noGoZones: [zone, { ...zone, id: 'z2', enabled: false }] })),
    ).toBe('2 zones (1 enabled)');
  });

  it('summarizes powered Z with travel and confirmation', () => {
    expect(zAxisStatus(withPatch({ capabilities: [] }))).toBe('No powered Z');
    const zCapable = withPatch({ capabilities: ['z-axis'] });
    expect(zAxisStatus(zCapable)).toBe('Powered Z — travel not set');
    expect(zAxisStatus({ ...zCapable, zTravelMm: 75 })).toBe('Powered Z, 75 mm unconfirmed');
    expect(zAxisStatus({ ...zCapable, zTravelMm: 75, zTravelConfirmed: true })).toBe(
      'Powered Z, 75 mm confirmed',
    );
  });

  it('always shows the planner values so nothing hides behind the collapse', () => {
    const status = plannerStatus(
      withPatch({ accelMmPerSec2: 1000, junctionDeviationMm: 0.01 }) as DeviceProfile,
    );
    expect(status).toContain('Accel 1000 mm/s²');
    expect(status).toContain('junction 0.01 mm');
    expect(status).toContain('×1.00/×1.00');
  });

  it('summarizes scan offsets, verification state, and controlled seek', () => {
    expect(
      scanOffsetStatus(
        withPatch({ scanningOffsets: [], controlledLaserOffTravelFeedMmPerMin: undefined }),
      ),
    ).toBe('Not calibrated');
    expect(
      scanOffsetStatus(
        withPatch({
          scanningOffsets: [{ speedMmPerMin: 3000, offsetMm: 0.1 }],
          scanOffsetCalibrationStatus: 'pending',
          controlledLaserOffTravelFeedMmPerMin: 800,
        }),
      ),
    ).toBe('1 point, verification pending, controlled seek 800 mm/min');
  });

  it('summarizes auto-focus, rotary, and camera states', () => {
    expect(autofocusStatus(withPatch({ autofocusCommand: '' }))).toBe('Not configured');
    expect(autofocusStatus(withPatch({ autofocusCommand: '$HZ1' }))).toBe('Configured');

    expect(rotaryStatus(withPatch({}))).toBe('Off');
    expect(
      rotaryStatus(
        withPatch({
          rotary: {
            enabled: true,
            type: 'roller',
            mmPerRotation: 100,
            objectDiameterMm: 60,
          },
        }),
      ),
    ).toBe('Roller, Ø60 mm');

    expect(cameraStatus(withPatch({}))).toBe('Not set up');
  });
});
