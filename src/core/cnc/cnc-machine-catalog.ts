// Built-in CNC machine catalog — common hobby routers, mirroring the laser
// profile-catalog so a CNC user can pick their machine instead of hand-entering
// bed size and spindle ceiling. A "machine" here spans the shared device bed
// (bedWidth/bedHeight) AND the CNC spindle ceiling (params.spindleMaxRpm), so a
// preset seeds both.
//
// PROVISIONAL / CLEAN-ROOM: these are approximate published work areas and
// typical spindle/router ceilings, not measured. The UI must say "confirm
// against your machine before the first cut" — travel and max RPM vary by
// model year, rail length, and which router/spindle is fitted.

export type CncMachinePreset = {
  readonly id: string;
  readonly name: string;
  // Usable work area (mm). Seeds the shared device bed.
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  // Spindle/router top speed (RPM). Seeds params.spindleMaxRpm (GRBL $30).
  readonly spindleMaxRpm: number;
  // One-line reminder of what to double-check for this machine.
  readonly note: string;
};

const CONFIRM =
  'Approximate — confirm work area and spindle max against your machine before cutting.';

export const CNC_MACHINE_CATALOG: ReadonlyArray<CncMachinePreset> = [
  {
    id: 'genmitsu-3018',
    name: 'Genmitsu 3018-PRO',
    bedWidthMm: 300,
    bedHeightMm: 180,
    spindleMaxRpm: 10000,
    note: CONFIRM,
  },
  {
    id: 'genmitsu-4040',
    name: 'Genmitsu 4040-PRO',
    bedWidthMm: 400,
    bedHeightMm: 400,
    spindleMaxRpm: 10000,
    note: CONFIRM,
  },
  {
    id: 'shapeoko-3',
    name: 'Shapeoko 3 (Standard)',
    bedWidthMm: 425,
    bedHeightMm: 425,
    spindleMaxRpm: 30000,
    note: `${CONFIRM} Spindle max depends on the fitted trim router.`,
  },
  {
    id: 'shapeoko-xxl',
    name: 'Shapeoko XXL',
    bedWidthMm: 838,
    bedHeightMm: 838,
    spindleMaxRpm: 30000,
    note: `${CONFIRM} Spindle max depends on the fitted trim router.`,
  },
  {
    id: 'xcarve-1000',
    name: 'X-Carve (1000 mm)',
    bedWidthMm: 750,
    bedHeightMm: 750,
    spindleMaxRpm: 24000,
    note: CONFIRM,
  },
  {
    id: 'onefinity-woodworker',
    name: 'Onefinity Woodworker',
    // Onefinity publishes the Woodworker as a 32″×32″ cut area (807×765 mm);
    // 16″-class numbers belong to the Machinist, which is not this preset.
    bedWidthMm: 807,
    bedHeightMm: 765,
    spindleMaxRpm: 24000,
    note: CONFIRM,
  },
  {
    id: 'onefinity-journeyman',
    name: 'Onefinity Journeyman',
    // Published Journeyman cut area is 48″×32″ (1214×765 mm).
    bedWidthMm: 1214,
    bedHeightMm: 765,
    spindleMaxRpm: 24000,
    note: CONFIRM,
  },
  {
    id: 'longmill-mk2-30x30',
    name: 'Sienci LongMill MK2 (30×30)',
    bedWidthMm: 810,
    bedHeightMm: 810,
    spindleMaxRpm: 24000,
    note: CONFIRM,
  },
];
