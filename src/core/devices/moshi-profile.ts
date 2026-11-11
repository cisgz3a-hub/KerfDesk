// The generic Moshiboard machine profile (ADR-705). Bed size and home corner
// follow MeerK40t's MoshiDevice defaults (meerk40t/moshi/device.py at
// d511944e: bedwidth 330 mm L77-86, bedheight 210 mm L90-99, a top-left home
// whose native Y grows toward the operator, L496-518). The feed ceiling is the
// vector speed byte's 256 mm/s (builder.py L392-397). Simulator-tested only.

import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';

export const GENERIC_MOSHI_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'generic-moshiboard-usb',
  catalogVersion: '2026-11-11',
  vendor: 'Generic',
  model: 'Moshiboard MS10105 CO2 (USB, experimental)',
  name: 'Generic Moshiboard CO2 330×210 (USB, experimental)',
  machineFamily: 'generic-moshiboard',
  controllerKind: 'moshi',
  bedWidth: 330,
  bedHeight: 210,
  maxFeed: 15360,
  framingFeedMmPerMin: 6000,
  origin: 'rear-left',
  homing: { enabled: false, direction: 'rear-left' },
  capabilities: ['laser-output', 'no-go-zones'],
  evidence: [
    {
      label: 'Moshiboard protocol (MeerK40t, MIT)',
      status: 'experimental',
      note: 'EXPERIMENTAL, simulator-tested only, not qualified on hardware: programs follow MeerK40t’s Moshi builder and controller, and run over a CH341 USB link from Machine details with Frame, Start, Abort and Home only. A Moshiboard has no software power control: set power on the machine. Coordinates are absolute from the home corner, up to 832 mm. Confirm the bed size and test on scrap with a hand on the machine’s stop.',
    },
  ],
};
