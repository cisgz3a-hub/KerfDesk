import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';

export const FALCON_A1_PRO_GRBLHAL_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'creality-falcon-a1-pro-grblhal',
  vendor: 'Creality',
  model: 'Falcon A1 Pro',
  name: 'Creality Falcon A1 Pro (grblHAL)',
  machineFamily: 'creality-falcon',
  controllerKind: 'grblhal',
  maxFeed: 10000,
  framingFeedMmPerMin: 10000,
  capabilities: [
    'grbl',
    'wcs',
    'air-assist',
    'verified-origin',
    'scan-offsets',
    'no-go-zones',
    'rotary',
    'low-power-fire',
  ],
  evidence: [
    {
      label: 'Falcon A1 Pro grblHAL hardware',
      status: 'hardware-verified',
      note: 'Confirmed working on a real Creality Falcon A1 Pro reporting GrblHAL 1.1f through the ADR-094 driver refactor, 2026-07-02. Confirm your own bed, S range, and air output before first production work.',
    },
  ],
};

export const FALCON_COMPATIBLE_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'creality-falcon-a1-pro-compatible',
  vendor: 'Creality',
  model: 'Falcon-compatible GRBL diode',
  name: 'Creality Falcon-compatible GRBL diode',
  machineFamily: 'creality-falcon',
  controllerKind: 'grbl-v1.1',
  maxFeed: 10000,
  framingFeedMmPerMin: 10000,
  capabilities: [
    'grbl',
    'wcs',
    'air-assist',
    'verified-origin',
    'scan-offsets',
    'no-go-zones',
    'rotary',
    'low-power-fire',
  ],
  evidence: [
    {
      label: 'KerfDesk Falcon-compatible fallback',
      status: 'simulator-tested',
      note: 'Uses the existing byte-stable Falcon-compatible GRBL output behavior verified by tests. Prefer the specific Falcon A1 Pro grblHAL profile when that firmware is detected.',
    },
  ],
};
