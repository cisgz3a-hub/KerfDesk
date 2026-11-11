// Stock K40 machine profiles (ADR-703): a CO2 laser with a Lihuiyu M2 Nano
// (or M3 Nano) board, homing to the rear-left corner (+x right, +y toward the
// front, as the board's own axes run). 300 x 200 mm is the commonly quoted
// usable K40 bed; MeerK40t's default is 310 x 210 (meerk40t/lihuiyu/device.py
// at d511944e, bedwidth/bedheight). 140 mm/s is MeerK40t's default vector
// speed ceiling (max_vector_speed); its default power cap for an M3 with
// hardware PWM is 30 % (power_scale), kept here as Full-power 300 per mille.

import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';

const K40_SOURCE =
  'MeerK40t lihuiyu driver (MIT), github.com/meerk40t/meerk40t at d511944e: device.py board list, bed size, max_vector_speed, power_scale.';
const SIMULATOR_ONLY =
  'EXPERIMENTAL: simulator-tested only, NOT qualified on hardware. Saves .egv files and drives the board over USB (CH341) through a separate link; the LHYMicro-GL encoding follows MeerK40t and round-trips through this app’s own decoder and simulator. Air-cut on scrap before burning.';

const K40_BASE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  catalogVersion: '2026-11-11',
  vendor: 'Generic',
  machineFamily: 'k40-lihuiyu',
  controllerKind: 'lihuiyu',
  bedWidth: 300,
  bedHeight: 200,
  origin: 'rear-left',
  maxFeed: 8400,
  framingFeedMmPerMin: 3000,
  capabilities: ['laser-output', 'no-go-zones'],
  laserSubProfile: {
    model: 'K40 CO2 tube',
    technology: 'co2',
    metadataConfidence: 'unverified',
    focusMode: 'manual',
    airAssist: 'unknown',
  },
};

export const K40_M2_NANO_PROFILE: DeviceProfile = {
  ...K40_BASE,
  profileId: 'k40-lihuiyu-m2-nano',
  model: 'K40 (Lihuiyu M2 Nano)',
  name: 'K40 300×200 (Lihuiyu M2 Nano)',
  lihuiyuBoard: 'M2',
  evidence: [
    {
      label: 'Lihuiyu LHYMicro-GL (MeerK40t)',
      status: 'experimental',
      note: `${SIMULATOR_ONLY} The M2 has no software power control: the machine’s current knob sets power, so layer power below 100 % is not applied. Source: ${K40_SOURCE}`,
    },
  ],
};

export const K40_M3_NANO_PWM_PROFILE: DeviceProfile = {
  ...K40_BASE,
  profileId: 'k40-lihuiyu-m3-nano-pwm',
  model: 'K40 (Lihuiyu M3 Nano, hardware PWM)',
  name: 'K40 300×200 (Lihuiyu M3 Nano, PWM)',
  lihuiyuBoard: 'M3-pwm',
  maxPowerS: 300,
  evidence: [
    {
      label: 'Lihuiyu LHYMicro-GL (MeerK40t)',
      status: 'experimental',
      note: `${SIMULATOR_ONLY} Only M3 firmware 2024.01.18g or newer reads PWM power; Full-power S is per mille (300 = 30 %, MeerK40t’s default cap — raising it can damage the tube). Source: ${K40_SOURCE}`,
    },
  ],
};
