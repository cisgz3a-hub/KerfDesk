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
    description:
      'Starting point for 3 mm MDF cutting. MDF varies heavily; expect smoke and verify with extraction.',
    warnings: ['MDF is smoky. Confirm air assist and extraction before cutting.'],
    recipe: { ...BASE_RECIPE, power: 100, speed: 500, airAssist: true },
  }),
  preset({
    id: 'neotronics-lt4lds-black-acrylic-3mm-cut',
    materialName: 'Black / opaque acrylic',
    thicknessMm: 3,
    description:
      'Starting point for opaque black acrylic on a blue diode. Do not transfer this to clear acrylic.',
    recipe: { ...BASE_RECIPE, power: 100, speed: 360, airAssist: true },
  }),
  preset({
    id: 'neotronics-lt4lds-paper-card-felt-thin-cut',
    materialName: 'Paper / cardboard / thin felt',
    title: 'Thin stock cut',
    description:
      'Starting point for thin stock only. Use a watched test grid first because these materials can ignite.',
    warnings: ['Thin stock can ignite. Stay present.'],
    recipe: { ...BASE_RECIPE, power: 90, speed: 4000, airAssist: true },
  }),
  preset({
    id: 'neotronics-lt4lds-clear-acrylic-unsupported',
    materialName: 'Clear acrylic',
    title: 'Unsupported',
    description:
      'Clear acrylic is not recommended for a 450/455 nm diode laser. Use opaque acrylic or another laser type.',
    unsupported: true,
    warnings: ['Clear acrylic is not recommended for a 450/455 nm diode laser.'],
    recipe: { ...BASE_RECIPE, power: 0, speed: 1000, airAssist: false },
  }),
];

export function materialPresetWarnings(preset: StarterMaterialPreset): ReadonlyArray<string> {
  return preset.warnings ?? [];
}

export function isUnsupportedPreset(preset: StarterMaterialPreset): boolean {
  return preset.unsupported === true;
}

function preset(input: Omit<StarterMaterialPreset, 'revision'>): StarterMaterialPreset {
  return { revision: REVISION, ...input };
}
