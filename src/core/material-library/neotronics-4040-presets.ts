import type { MaterialRecipe } from './material-library';

export type StarterMaterialPreset = {
  readonly id: string;
  readonly materialName: string;
  readonly thicknessMm?: number;
  readonly title?: string;
  readonly description: string;
  readonly recipe: MaterialRecipe;
  readonly revision: string;
  readonly warnings?: ReadonlyArray<string>;
  readonly unsupported?: boolean;
};

const BASE_RECIPE: MaterialRecipe = {
  mode: 'line',
  minPower: 0,
  power: 30,
  speed: 5000,
  passes: 1,
  airAssist: false,
  kerfOffsetMm: 0,
  tabsEnabled: false,
  tabSizeMm: 0.5,
  tabsPerShape: 4,
  tabSkipInnerShapes: true,
  hatchAngleDeg: 0,
  hatchSpacingMm: 0.1,
  fillOverscanMm: 5,
  fillBidirectional: true,
  fillCrossHatch: false,
  ditherAlgorithm: 'threshold',
  linesPerMm: 10,
  negativeImage: false,
  passThrough: false,
  dotWidthCorrectionMm: 0,
};

const REVISION = 'neotronics-lt4lds-v2-20w-research-2026-06-16';
// Presets whose values changed in the 2026-09-24 settings audit carry their own
// revision, so a layer linked to the earlier values reads as stale in Job Review.
const AUDIT_REVISION = 'neotronics-lt4lds-v2-20w-audit-2026-09-24';

export const NEOTRONICS_4040_MAX_LT4LDS_V2_PRESETS: ReadonlyArray<StarterMaterialPreset> = [
  preset({
    id: 'neotronics-lt4lds-wood-engrave-254dpi',
    materialName: 'Basswood / plywood',
    title: 'Engrave 254 DPI',
    description:
      'Starting point for surface engraving on a 20W 450/455 nm diode. Run Material Test and Interval Test before production.',
    recipe: {
      ...BASE_RECIPE,
      mode: 'image',
      power: 30,
      speed: 5000,
      linesPerMm: 10,
      ditherAlgorithm: 'floyd-steinberg',
      airAssist: false,
    },
  }),
  preset({
    id: 'neotronics-lt4lds-plywood-3mm-cut',
    materialName: 'Basswood / plywood',
    thicknessMm: 3,
    description:
      'Starting point for 3 mm plywood cutting. Use air assist, verify focus, and tune speed on scrap.',
    recipe: { ...BASE_RECIPE, power: 100, speed: 500, airAssist: true },
  }),
  preset({
    id: 'neotronics-lt4lds-mdf-3mm-cut',
    materialName: 'MDF',
    thicknessMm: 3,
    revision: AUDIT_REVISION,
    // xTool's 20 W MDF guide (xtool.com/blogs/xtool-academy/laser-cut-mdf) cuts
    // 3 mm MDF at 100%, 480 mm/min in 2 passes. MDF's resin makes it slower than
    // plywood: Sculpfun's S30 table cuts MDF at 300 mm/min against 780 for plywood.
    description:
      'Starting point for 3 mm MDF cutting, from published 20 W settings. MDF varies heavily; expect smoke and verify with extraction.',
    warnings: [
      'MDF is smoky. Confirm air assist and extraction before cutting.',
      'Cut a test piece first: MDF density and glue vary between boards.',
    ],
    recipe: { ...BASE_RECIPE, power: 100, speed: 480, passes: 2, airAssist: true },
  }),
  preset({
    id: 'neotronics-lt4lds-black-acrylic-3mm-cut',
    materialName: 'Black / opaque acrylic',
    thicknessMm: 3,
    description:
      'Starting point for opaque black acrylic on a blue diode. Do not transfer this to clear acrylic.',
    // xTool support article 555: a blue diode cannot cut clear, white or blue acrylic.
    warnings: [
      'Black opaque sheet only: a 450/455 nm diode cannot cut clear, white or blue acrylic, and other colours need their own test.',
    ],
    recipe: { ...BASE_RECIPE, power: 100, speed: 360, airAssist: true },
  }),
  preset({
    id: 'neotronics-lt4lds-paper-card-felt-thin-cut',
    materialName: 'Paper / cardboard / thin felt',
    title: 'Thin stock cut',
    revision: AUDIT_REVISION,
    // Dynamic power (M4) scales the beam with the actual speed. In constant power
    // (M3) a 90° corner slows to about 208 mm/min while the beam stays at 90%,
    // about 19 times the energy per mm, which chars or lights thin stock. The
    // values follow Creality's Falcon material table, which runs in M4.
    description:
      'Starting point for paper, card and thin felt only, not corrugated cardboard. Use a watched test grid first because these materials can ignite.',
    warnings: [
      'Thin stock can ignite. Stay present.',
      'Not for corrugated cardboard: test it separately.',
    ],
    recipe: { ...BASE_RECIPE, powerMode: 'dynamic', power: 90, speed: 4000, airAssist: true },
  }),
  preset({
    id: 'neotronics-lt4lds-clear-acrylic-unsupported',
    materialName: 'Clear acrylic',
    title: 'Unsupported',
    // xTool support article 555: clear acrylic is transparent to the blue diode
    // wavelength, so it can be neither cut nor engraved directly.
    description:
      'A 450/455 nm diode laser cannot cut or engrave clear acrylic because the beam passes through it. Use opaque acrylic or a CO2 laser.',
    unsupported: true,
    warnings: ['A 450/455 nm diode laser cannot cut or engrave clear acrylic.'],
    recipe: { ...BASE_RECIPE, power: 0, speed: 1000, airAssist: false },
  }),
];

export function materialPresetWarnings(preset: StarterMaterialPreset): ReadonlyArray<string> {
  return preset.warnings ?? [];
}

export function isUnsupportedPreset(preset: StarterMaterialPreset): boolean {
  return preset.unsupported === true;
}

function preset(
  input: Omit<StarterMaterialPreset, 'revision'> & { readonly revision?: string },
): StarterMaterialPreset {
  return { revision: REVISION, ...input };
}
