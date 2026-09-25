import {
  DEFAULT_DEVICE_PROFILE,
  type DeviceProfile,
  type LaserSubProfile,
  type ProfileCapability,
} from './device-profile';

const LASER_CAPABILITIES: ReadonlyArray<ProfileCapability> = [
  'grbl',
  'wcs',
  'laser-output',
  'verified-origin',
  'scan-offsets',
  'no-go-zones',
  'rotary',
];
const RESEARCHED_AT = '2026-09-19';
const CONFIGURED_TRAVEL_NOTE =
  'Controller-reported configured travel is not a measurement of usable travel with the fitted head. Confirm firmware, homing, S range and usable work area.';

function diodeProfile(args: {
  readonly profileId: string;
  readonly vendor: string;
  readonly model: string;
  readonly machineFamily: string;
  readonly bedWidth: number;
  readonly bedHeight: number;
  readonly opticalPowerW: number;
  readonly source: string;
  readonly note: string;
}): DeviceProfile & { readonly laserSubProfile: LaserSubProfile } {
  return {
    ...DEFAULT_DEVICE_PROFILE,
    profileId: args.profileId,
    vendor: args.vendor,
    model: args.model,
    name: `${args.vendor} ${args.model}`,
    machineFamily: args.machineFamily,
    catalogVersion: RESEARCHED_AT,
    controllerKind: 'grbl-v1.1',
    bedWidth: args.bedWidth,
    bedHeight: args.bedHeight,
    capabilities: LASER_CAPABILITIES,
    laserSubProfile: {
      model: args.model,
      technology: 'diode',
      opticalPowerW: args.opticalPowerW,
      metadataConfidence: 'researched',
      focusMode: 'manual',
      airAssist: 'unknown',
    },
    evidence: [
      {
        label: `${args.vendor} ${args.model} public specifications`,
        status: 'public-spec-starter',
        note: `${args.note} ${CONFIGURED_TRAVEL_NOTE} Source checked ${RESEARCHED_AT}: ${args.source}`,
      },
    ],
  };
}

const XTOOL_SOURCE =
  'https://xtool.zendesk.com/hc/en-us/articles/14109952045463-D1-Pro-Product-Introduction';
const XTOOL_40W_SOURCE = 'https://uk.xtool.com/products/40w-laser-module-for-d1-pro';
// xTool's own LightBurn device file for the D1 Pro sets "MirrorY": true (origin
// at the rear, +Y toward the operator), "BaudRate": 230400 and
// "EnableGrblJCommand": false. Whether the closed firmware rejects `$J=` is not
// public (controller audit OR-4, plausible only), so these profiles keep the
// GRBL `$J=` jog and Frame and say so in their evidence note instead.
const XTOOL_LIGHTBURN_DEVICE =
  'https://xtool.zendesk.com/hc/article_attachments/7316804567447/xTool-D1ProV3.lbdev';

function xtoolProfile(power: 5 | 10 | 20 | 40, bedHeight: number): DeviceProfile {
  return {
    ...diodeProfile({
      // Retain the original ID for its existing 430 x 390 mm (20 W) geometry.
      profileId: power === 20 ? 'xtool-d1-pro' : `xtool-d1-pro-${power}w`,
      vendor: 'xTool',
      model: `D1 Pro (${power} W)`,
      machineFamily: 'xtool-d1-pro',
      bedWidth: 430,
      bedHeight,
      opticalPowerW: power,
      source: `${power === 40 ? XTOOL_40W_SOURCE : XTOOL_SOURCE}; ${XTOOL_LIGHTBURN_DEVICE}`,
      note: `${power} W head on the standard frame: 430 x ${bedHeight} mm. Extension rails and other heads need their own dimensions. xTool's LightBurn device file puts the origin at the rear-left, uses 230400 baud and sets EnableGrblJCommand: false, so LightBurn does not jog it with $J=. KerfDesk's Jog and Frame use $J= jog commands: if Jog or Frame fails with an error on this firmware, the machine is not compatible with $J= jogging.`,
    }),
    origin: 'rear-left',
    homing: { enabled: false, direction: 'rear-left' },
    baudRate: 230400,
  };
}

export const XTOOL_D1_PRO_PROFILES: ReadonlyArray<DeviceProfile> = [
  xtoolProfile(20, 390),
  xtoolProfile(5, 400),
  xtoolProfile(10, 400),
  xtoolProfile(40, 348),
];

const SCULPFUN_S30_BASE = diodeProfile({
  profileId: 'sculpfun-s30',
  vendor: 'Sculpfun',
  model: 'S30 (5 W, stock automatic air)',
  machineFamily: 'sculpfun-s30',
  // The cited product page gives the standard engraving area as 380 x 385 mm
  // (its Y-axis kit gives 380 x 920, so 380 is X). Sculpfun's firmware sets
  // $130=400 / $131=410 with soft limits off, so larger values can drive X into
  // the frame.
  bedWidth: 380,
  bedHeight: 385,
  opticalPowerW: 5,
  source:
    'https://www.sculpfun.com/products/sculpfun-s30-5w-laser-engraver-rotary-roller-40-40cm-honeycomb-panel',
  note: 'Base S30: 380 x 385 mm engraving area and a supplied M8-controlled pump. Sculpfun firmware ships with homing and hard limits on ($22=1, $21=1) and M9 drops the pump to low air rather than off. Pro/Max heads and extension kits differ.',
});

export const SCULPFUN_S30_PROFILE: DeviceProfile = {
  ...SCULPFUN_S30_BASE,
  airAssistCommand: 'M8',
  capabilities: [...LASER_CAPABILITIES, 'air-assist'],
  laserSubProfile: {
    ...SCULPFUN_S30_BASE.laserSubProfile,
    airAssist: 'built-in',
  },
};

export const SCULPFUN_S30_MANUAL_AIR_PROFILE: DeviceProfile = {
  ...SCULPFUN_S30_BASE,
  profileId: 'sculpfun-s30-manual-air',
  name: 'Sculpfun S30 (5 W, manual air)',
  model: 'S30 (5 W, manual air)',
  laserSubProfile: {
    ...SCULPFUN_S30_BASE.laserSubProfile,
    airAssist: 'manual',
  },
  evidence: [
    {
      label: 'S30 with a manually controlled pump',
      status: 'public-spec-starter',
      note: `Base S30 geometry with software air commands disabled for a modified/manual pump installation. Stock S30 uses M8; choose the automatic-air profile for the supplied pump. ${CONFIGURED_TRAVEL_NOTE} Source checked ${RESEARCHED_AT}: https://www.sculpfun.com/blogs/blog/sculpfun-s30-series`,
    },
  ],
};

function orturProfile(power: 10 | 20 | 40): DeviceProfile {
  const head = power === 10 ? 'LU2-10A' : `LU3-${power}A`;
  const bedHeight = power === 10 ? 400 : 380;
  return diodeProfile({
    // Existing saved 400 x 400 profiles keep their ID and their 10 W scope.
    profileId: power === 10 ? 'ortur-laser-master-3' : `ortur-laser-master-3-${power}w`,
    vendor: 'Ortur',
    model: `Laser Master 3 (${head}, ${power} W)`,
    machineFamily: 'ortur-laser-master-3',
    bedWidth: 400,
    bedHeight,
    opticalPowerW: power,
    source: 'https://ortur.net/pages/support-olm3',
    note: `${head}: 400 x ${bedHeight} mm; published S maximum 1000 and default baud 115200. The app feed ceiling is a conservative starter, not the manufacturer's maximum.`,
  });
}

export const ORTUR_LASER_MASTER_3_PROFILES: ReadonlyArray<DeviceProfile> = [
  orturProfile(10),
  orturProfile(20),
  orturProfile(40),
];
