import { portraitAutoTones } from '../../core/raster/portrait-auto-tones';
import type { PhotoEngravingDraft } from './photo-engraving-settings';

/**
 * ADR-685: a material recipe prepares a portrait for one kind of surface. It
 * sets only the photo's processing: which way the material marks, Blue Noise,
 * auto tones and a light sharpen. Power, speed, DPI and tone calibration are
 * the machine's and material's, so a recipe never sets them.
 */
export type PhotoRecipe = {
  readonly id: string;
  readonly label: string;
  /** Short name for the material view caption. */
  readonly surfaceName: string;
  /** Light marks: the material marks lighter than its surface (Negative). */
  readonly lightMarks: boolean;
  /** Engraved from the back and seen through it, so the photo must be mirrored. */
  readonly mirror: boolean;
  /** Material-view colours, a display simulation only. */
  readonly surface: string;
  readonly mark: string;
  readonly note: string;
};

/* eslint-disable no-restricted-syntax -- simulated material colours, not UI chrome (ADR-047). */
export const PHOTO_RECIPES: ReadonlyArray<PhotoRecipe> = [
  {
    id: 'wood',
    surfaceName: 'wood',
    label: 'Wood, plywood or MDF',
    lightMarks: false,
    mirror: false,
    surface: '#dcc196',
    mark: '#3e2614',
    note: 'Pale, close-grained wood such as maple, birch or basswood shows the most detail. Grain and resin burn unevenly.',
  },
  {
    id: 'leather',
    surfaceName: 'leather',
    label: 'Leather or cork',
    lightMarks: false,
    mirror: false,
    surface: '#b98a5e',
    mark: '#3a2212',
    note: 'Natural vegetable-tanned leather marks evenly; coated or synthetic leather may melt instead of darkening.',
  },
  {
    id: 'white-tile',
    surfaceName: 'white tile',
    label: 'White tile or coated metal (dark marks)',
    lightMarks: false,
    mirror: false,
    surface: '#f1f0ec',
    mark: '#1f1f1f',
    note: 'For a marking coating that the laser fuses dark, such as the white-tile method. Wash off the unfused coating after burning.',
  },
  {
    id: 'slate',
    surfaceName: 'slate',
    label: 'Black slate or stone',
    lightMarks: true,
    mirror: false,
    surface: '#363a3d',
    mark: '#b8bdc1',
    note: 'Slate marks light grey. Its surface is uneven, so a flat, smooth piece keeps the face clearest.',
  },
  {
    id: 'anodized',
    surfaceName: 'anodized aluminium',
    label: 'Black anodized aluminium or painted surface',
    lightMarks: true,
    mirror: false,
    surface: '#1e1f21',
    mark: '#dddddd',
    note: 'The laser removes the dark layer and shows the bright surface beneath it.',
  },
  {
    id: 'clear-back',
    surfaceName: 'clear acrylic or glass',
    label: 'Clear acrylic or glass, from the back',
    lightMarks: true,
    mirror: true,
    surface: '#2a2d31',
    mark: '#e6ecf0',
    note: 'Burns a frosted, light mark you view through the front.',
  },
];
/* eslint-enable no-restricted-syntax */

export const PHOTO_RECIPE_SHARPEN = { sharpenAmount: 30, sharpenRadius: 0.7 } as const;

export function photoRecipe(id: string | null): PhotoRecipe | null {
  return PHOTO_RECIPES.find((recipe) => recipe.id === id) ?? null;
}

/** Auto tones for the draft, or null when the photo's histogram is not known yet. */
export function autoTonesPatch(
  histogram: ArrayLike<number> | null,
): Pick<PhotoEngravingDraft, 'brightness' | 'contrast' | 'gamma'> | null {
  return histogram === null ? null : portraitAutoTones(histogram);
}

/** The draft changes a recipe makes; tones only when the histogram is known. */
export function photoRecipePatch(
  recipe: PhotoRecipe,
  histogram: ArrayLike<number> | null,
): Partial<PhotoEngravingDraft> {
  return {
    ditherAlgorithm: 'blue-noise',
    negativeImage: recipe.lightMarks,
    ...PHOTO_RECIPE_SHARPEN,
    ...(autoTonesPatch(histogram) ?? {}),
  };
}
