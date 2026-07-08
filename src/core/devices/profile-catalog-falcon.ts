import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';

export const FALCON_COMPATIBLE_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'creality-falcon-a1-pro-compatible',
  vendor: 'Creality',
  model: 'Falcon-compatible GRBL diode fallback',
  name: 'Falcon-compatible GRBL diode fallback',
  machineFamily: 'creality-falcon',
  framingFeedMmPerMin: 10000,
  capabilities: ['grbl', 'wcs', 'air-assist', 'verified-origin', 'scan-offsets', 'no-go-zones'],
  evidence: [
    {
      label: 'Falcon-compatible simulator baseline',
      status: 'researched',
      note: 'Fallback for Falcon-style GRBL diode machines. Output behavior is simulator-tested; confirm controller kind, bed size, S range, and air output before hardware use.',
    },
  ],
};

export const CREALITY_FALCON_A1_PRO_GRBLHAL_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'creality-falcon-a1-pro-grblhal',
  vendor: 'Creality',
  model: 'Falcon A1 Pro',
  name: 'Creality Falcon A1 Pro (grblHAL)',
  machineFamily: 'creality-falcon',
  controllerKind: 'grblhal',
  bedWidth: 400,
  bedHeight: 400,
  maxFeed: 36000,
  maxPowerS: 1000,
  minPowerS: 0,
  laserModeEnabled: true,
  airAssistCommand: 'none',
  framingFeedMmPerMin: 10000,
  capabilities: ['grbl', 'wcs', 'air-assist', 'verified-origin', 'scan-offsets', 'no-go-zones'],
  evidence: [
    {
      label: 'Falcon A1 Pro grblHAL smoke test',
      status: 'researched',
      note: 'Detected as grblHAL with a 400x400 work area and S1000 scale. Controller-read facts still win during setup; enable M7/M8 air output only after confirming wiring.',
    },
  ],
};
