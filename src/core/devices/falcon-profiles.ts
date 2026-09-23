import { GRBLHAL_DEFAULT_RX_BUFFER_BYTES } from '../grbl-streaming';
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
  // grblHAL keeps a >= 1 KiB serial receive ring; a maintainer's A1 Pro, profiled as
  // grblHAL, reported `Bf:512,65535` on 2026-07-19 (informal, not qualification). The
  // stock 120-byte window can starve the planner on dense raster jobs (simulator-shown,
  // ADR-331). Start still bounds this by the controller's own `Bf:` capacity report.
  rxBufferBytes: GRBLHAL_DEFAULT_RX_BUFFER_BYTES,
  airAssistCommand: 'M8',
  // The A1's own air control is timer-backed, so a mid-program M9 is not a
  // clean off: `$152` (standby wait, default 30 s; 100 = never) idles the pump
  // afterwards and the restart is what users report failing. Air is held
  // across an Air-off operation that sits between two Air-on ones rather than
  // cycled over it (ADR-335).
  airAssistRestartUnreliable: true,
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
      note: 'Creality LightBurn bundle checked 2026-09-19: Width 358, Height 268, S scale 1000, baud 115200, M8 air, autofocus $HZ1, no $J jogging or settings fetch. Vendor labels the connection GRBL-LPC; the exact firmware build is not independently established. The retained grblHAL family selection uses model-specific command overrides; it is not hardware qualification. A live 2026-07-19 status report from a maintainer A1 Pro read Bf:512,65535 (512 planner blocks and 65535 receive-buffer bytes free; informal, not qualification), so the profile requests the grblHAL 1024-byte streaming window; Start bounds it by the controller-reported capacity (ADR-331). Source: https://wiki.creality.com/en/laser-engraver/falcon-a1-pro/lightburn-guide',
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
