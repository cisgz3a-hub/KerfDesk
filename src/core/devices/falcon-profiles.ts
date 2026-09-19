import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';

export const FALCON_A1_PRO_GRBLHAL_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'creality-falcon-a1-pro-grblhal',
  vendor: 'Creality',
  model: 'Falcon A1 Pro',
  name: 'Creality Falcon A1 Pro (vendor command set)',
  catalogVersion: '2026-09-19',
  machineFamily: 'creality-falcon',
  controllerKind: 'grblhal',
  controllerCommandSet: 'creality-falcon-a1-pro',
  // Creality's supplied LightBurn bundle explicitly names Width and Height;
  // its product page instead lists the two lengths without X/Y labels.
  bedWidth: 358,
  bedHeight: 268,
  baudRate: 115200,
  airAssistCommand: 'M8',
  autofocusCommand: '$HZ1',
  maxFeed: 10000,
  framingFeedMmPerMin: 10000,
  capabilities: [
    'grbl',
    'wcs',
    'laser-output',
    'air-assist',
    'verified-origin',
    'scan-offsets',
    'no-go-zones',
    'rotary',
    'low-power-fire',
  ],
  evidence: [
    {
      label: 'Creality Falcon A1 Pro manufacturer configuration',
      status: 'public-spec-starter',
      note: 'Creality LightBurn bundle checked 2026-09-19: Width 358, Height 268, S scale 1000, baud 115200, M8 air, autofocus $HZ1, no $J jogging or settings fetch. Vendor labels the connection GRBL-LPC; the exact firmware build is not independently established. The retained grblHAL family selection uses model-specific command overrides; it is not hardware qualification. Source: https://wiki.creality.com/en/laser-engraver/falcon-a1-pro/lightburn-guide',
    },
  ],
};

export const FALCON_COMPATIBLE_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'creality-falcon-a1-pro-compatible',
  vendor: 'Creality',
  model: 'Falcon-compatible GRBL diode',
  name: 'Creality Falcon-compatible GRBL diode',
  catalogVersion: '2026-09-19',
  machineFamily: 'creality-falcon',
  controllerKind: 'grbl-v1.1',
  maxFeed: 10000,
  framingFeedMmPerMin: 10000,
  capabilities: [
    'grbl',
    'wcs',
    'laser-output',
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
      note: 'Generic GRBL output has simulator coverage; this 400 x 400 mm fallback does not identify a Falcon model. A1, A1 Pro, Falcon2 and Falcon2 Pro have different work areas and firmware commands. Select a model-specific profile or confirm configured travel and usable work area. No hardware qualification. Family source checked 2026-09-19: https://www.crealityfalcon.com/collections/laser-engravers',
    },
  ],
};
