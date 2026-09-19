// Geometry/RPM starters, not controller selections or qualified postprocessors.
// Selecting one does not change the connected driver, wiring or firmware settings.
export type CncMachinePreset = {
  readonly id: string;
  readonly name: string;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  // Nominal or conservative application RPM ceiling, not a measured speed.
  // A firmware S maximum is not necessarily an RPM rating.
  readonly spindleMaxRpm: number;
  readonly note: string;
  // Source-described family only; even GRBL requires the listed configuration.
  readonly controllerSupport: 'grbl-family' | 'unqualified';
  readonly controllerNote: string;
  readonly researchedAt: string;
  readonly sources: ReadonlyArray<{
    readonly label: string;
    readonly url: string;
    readonly supports: string;
  }>;
};

const RESEARCHED_AT = '2026-09-19';
const CONFIRM =
  'Confirm usable work area, fitted spindle/router and its control method before cutting. This preset changes application dimensions/RPM only.';
const ONEFINITY_CONTROLLER_NOTE =
  'Geometry template only. Stock Buildbotics, MASSO and Redline controllers have no qualified KerfDesk driver or postprocessor. Selecting this preset keeps the current controller. GRBL output is not a qualified Onefinity program; for example, MASSO dwell P uses milliseconds instead of GRBL seconds.';
const ONEFINITY_SOURCES = [
  {
    label: 'Onefinity controller generations',
    url: 'https://www.onefinitycnc.com/support',
    supports:
      'Distinct Buildbotics, MASSO and Redline resources; does not verify the retained legacy dimensions.',
  },
  {
    label: 'MASSO dwell command',
    url: 'https://docs.masso.com.au/supported-g-codes/g04-dwell',
    supports: 'G04 P is milliseconds; a generic GRBL dwell is not portable.',
  },
] as const;

export const CNC_MACHINE_CATALOG: ReadonlyArray<CncMachinePreset> = [
  {
    id: 'genmitsu-3018',
    name: 'Genmitsu 3018-PRO',
    bedWidthMm: 300,
    bedHeightMm: 180,
    spindleMaxRpm: 10000,
    note: `${CONFIRM} The 10,000 value is a nominal sender starter, not measured spindle RPM. The non-homing PRO and PROVer are different configurations.`,
    controllerSupport: 'grbl-family',
    controllerNote:
      'Manufacturer documents GRBL/Candle. Match the board revision and baud (115200 or documented 57600 variants); do not infer homing or probe wiring from the model name.',
    researchedAt: RESEARCHED_AT,
    sources: [
      {
        label: 'SainSmart 3018-PRO specification',
        url: 'https://www.sainsmart.com/products/sainsmart-genmitsu-cnc-router-3018-pro-diy-kit',
        supports: '300 x 180 x 45 mm travel and GRBL controller.',
      },
      {
        label: 'SainSmart Candle setup',
        url: 'https://docs.sainsmart.com/article/7c20d7zaw3',
        supports: 'Sender settings and baud variants; does not establish measured spindle RPM.',
      },
    ],
  },
  {
    id: 'genmitsu-4040',
    name: 'Genmitsu 4040-PRO (stock spindle)',
    bedWidthMm: 400,
    bedHeightMm: 400,
    spindleMaxRpm: 9000,
    note: `${CONFIRM} The stock 4040-PRO table specifies 9,000 RPM; upgraded spindles need their own rating and S-scale configuration.`,
    controllerSupport: 'grbl-family',
    controllerNote:
      'Manufacturer identifies GRBL, limit switches and a Z probe. Match the actual board/firmware and probe setup; these are not supplied by the size preset.',
    researchedAt: RESEARCHED_AT,
    sources: [
      {
        label: 'SainSmart 4040-PRO specification',
        url: 'https://www.sainsmart.com/products/genmitsu-4040-pro-semi-assembly-desktop-cnc-machine-for-carving-and-cutting',
        supports:
          '4040-PRO column: 400 x 400 x 78 mm, 9,000 RPM stock spindle and GRBL. The 10,000 RPM column describes Other 4040.',
      },
    ],
  },
  {
    id: 'neotronics-4040-max',
    name: 'Neotronics 4040 Max (500 W spindle)',
    bedWidthMm: 400,
    bedHeightMm: 400,
    spindleMaxRpm: 12000,
    note: `${CONFIRM} This preset assumes the 500 W spindle (12,000 RPM); confirm against the fitted machine. The vendor also lists a 710 W alternative.`,
    controllerSupport: 'unqualified',
    controllerNote:
      'The cited mechanical and spindle specifications do not identify the controller build. Confirm a supported GRBL-family firmware and actual spindle wiring; this size preset does not select either.',
    researchedAt: RESEARCHED_AT,
    sources: [
      {
        label: 'Neotronics 4040 Max machine',
        url: 'https://neotronics.co.za/index.php?product_id=1018&route=product%2Fproduct',
        supports: '400 x 400 x 75 mm envelope; spindle variants exist.',
      },
      {
        label: 'Neotronics 500 W spindle',
        url: 'https://neotronics.co.za/index.php?product_id=297&route=product%2Fproduct',
        supports: '500 W variant rated up to 12,000 RPM; not the 710 W variant.',
      },
    ],
  },
  {
    id: 'shapeoko-3',
    name: 'Shapeoko 3 (Standard)',
    bedWidthMm: 425,
    bedHeightMm: 425,
    spindleMaxRpm: 30000,
    note: `${CONFIRM} Published 425 x 425 mm travel includes front overhang; Carbide Create uses 406.4 x 406.4 mm. The 30,000 RPM cap assumes a Carbide Compact Router, not every fitted router.`,
    controllerSupport: 'grbl-family',
    controllerNote:
      'Shapeoko 3 uses Carbide Motion GRBL electronics; confirm installed firmware. A manually powered router is not switched or speed-controlled merely by emitted M3/S words.',
    researchedAt: RESEARCHED_AT,
    sources: [
      {
        label: 'Carbide 3D staff Shapeoko 3 dimensions',
        url: 'https://community.carbide3d.com/t/complete-footprint-of-the-shapeoko-3/4190/7',
        supports:
          '425 x 425 mm travel including front overhang; Carbide Create area 406.4 x 406.4 mm.',
      },
      {
        label: 'Carbide Compact Router',
        url: 'https://shop.carbide3d.com/products/carbide-compact-router',
        supports: '12,000 to 30,000 RPM for this router only.',
      },
      {
        label: 'Carbide 3D Shapeoko 3 assembly manual',
        url: 'https://my.carbide3d.com/pdf/shapeoko3_assembly.pdf',
        supports:
          'June 2020 revision identifies the Carbide Motion board as GRBL 1.1; older firmware still requires identification.',
      },
    ],
  },
  {
    id: 'shapeoko-xxl',
    name: 'Shapeoko 3 XXL',
    bedWidthMm: 838,
    bedHeightMm: 838,
    spindleMaxRpm: 30000,
    note: `${CONFIRM} Shapeoko 3 generation only. The 30,000 RPM cap assumes a Carbide Compact Router; manual router operation and other router ratings remain separate.`,
    controllerSupport: 'grbl-family',
    controllerNote:
      'Shapeoko 3 GRBL electronics only; later Shapeoko generations and replacement controllers require their own configuration. M3/S does not set a manual router dial.',
    researchedAt: RESEARCHED_AT,
    sources: [
      {
        label: 'Carbide 3D staff Shapeoko dimensions',
        url: 'https://community.carbide3d.com/t/complete-footprint-of-the-shapeoko-3/4190/7',
        supports: 'Shapeoko 3 XXL 33-inch class envelope; does not describe later generations.',
      },
      {
        label: 'Carbide Compact Router',
        url: 'https://shop.carbide3d.com/products/carbide-compact-router',
        supports: '30,000 RPM maximum for the named fitted router.',
      },
      {
        label: 'Carbide 3D Shapeoko 3 XXL assembly manual',
        url: 'https://my.carbide3d.com/pdf/shapeoko3_xxl_assembly.pdf',
        supports:
          'The documented Shapeoko 3 XXL board uses GRBL 1.1; not a claim about all later Shapeoko models.',
      },
    ],
  },
  {
    id: 'xcarve-1000',
    name: 'X-Carve 1000 mm (November 2021)',
    bedWidthMm: 750,
    bedHeightMm: 750,
    spindleMaxRpm: 24000,
    note: `${CONFIRM} 24,000 RPM is a conservative app cap, not the Makita router maximum (30,000). Older DeWalt-equipped machines differ.`,
    controllerSupport: 'grbl-family',
    controllerNote:
      'GRBL X-Controller configuration required. The fitted trim router may be manually switched and speed-adjusted; M3/S alone cannot establish its physical state.',
    researchedAt: RESEARCHED_AT,
    sources: [
      {
        label: 'Inventables November 2021 X-Carve',
        url: 'https://easel.inventables.com/partners/machines/inventables-x-carve-nov2021',
        supports: '750 x 750 mm work area for the identified generation.',
      },
      {
        label: 'Inventables router usage',
        url: 'https://x-carve-instructions.inventables.com/upgrade/step3/2usage/',
        supports: 'Fitted router and manual speed settings, not a universal software RPM contract.',
      },
    ],
  },
  {
    id: 'onefinity-woodworker',
    name: 'Onefinity Woodworker (geometry only)',
    // Retained legacy template; exact model-year travel is not verified.
    bedWidthMm: 807,
    bedHeightMm: 765,
    spindleMaxRpm: 24000,
    note: `${CONFIRM} Legacy geometry is unverified for a specific model year. The dimensions and 24,000 RPM cap establish no controller or postprocessor compatibility.`,
    controllerSupport: 'unqualified',
    controllerNote: ONEFINITY_CONTROLLER_NOTE,
    researchedAt: RESEARCHED_AT,
    sources: ONEFINITY_SOURCES,
  },
  {
    id: 'onefinity-journeyman',
    name: 'Onefinity Journeyman (geometry only)',
    bedWidthMm: 1214,
    bedHeightMm: 765,
    spindleMaxRpm: 24000,
    note: `${CONFIRM} Legacy geometry is unverified for a specific model year. The dimensions and 24,000 RPM cap establish no controller or postprocessor compatibility.`,
    controllerSupport: 'unqualified',
    controllerNote: ONEFINITY_CONTROLLER_NOTE,
    researchedAt: RESEARCHED_AT,
    sources: ONEFINITY_SOURCES,
  },
  {
    id: 'longmill-mk2-30x30',
    name: 'Sienci LongMill MK2 (30×30)',
    bedWidthMm: 810,
    bedHeightMm: 810,
    spindleMaxRpm: 24000,
    note: `${CONFIRM} 810 x 810 mm is a conservative template within the published 818 x 866 mm travel. 24,000 RPM is an app cap; the fitted router determines its actual rating and control.`,
    controllerSupport: 'grbl-family',
    controllerNote:
      'Select GRBL 1.1h for LongBoard or grblHAL for SuperLongBoard. This preset does not choose the controller or implement manual router switching/speed control.',
    researchedAt: RESEARCHED_AT,
    sources: [
      {
        label: 'Sienci LongMill calibration dimensions',
        url: 'https://resources.sienci.com/view/gs-calibration-tools/?print=print',
        supports: 'MK2 30 x 30 configured travel reference 818 x 866 mm.',
      },
      {
        label: 'Sienci LongMill MK2 specifications',
        url: 'https://resources.sienci.com/view/lmk2-mk2-specs/?print=print',
        supports: 'LongBoard GRBL and SuperLongBoard grblHAL configurations; router variants.',
      },
    ],
  },
];
