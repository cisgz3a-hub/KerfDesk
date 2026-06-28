import { DITHER_ALGORITHMS, type DitherAlgorithm, type Layer, type LayerMode } from '../scene';

export type MaterialRecipe = {
  readonly mode: LayerMode;
  readonly minPower: number;
  readonly power: number;
  readonly speed: number;
  readonly passes: number;
  readonly airAssist?: boolean;
  readonly kerfOffsetMm?: number;
  readonly tabsEnabled?: boolean;
  readonly tabSizeMm?: number;
  readonly tabsPerShape?: number;
  readonly tabSkipInnerShapes?: boolean;
  readonly hatchAngleDeg: number;
  readonly hatchSpacingMm: number;
  readonly fillOverscanMm: number;
  readonly fillStyle?: Layer['fillStyle'];
  readonly fillBidirectional: boolean;
  readonly fillCrossHatch: boolean;
  readonly ditherAlgorithm: DitherAlgorithm;
  readonly linesPerMm: number;
  readonly negativeImage: boolean;
  readonly passThrough: boolean;
  readonly dotWidthCorrectionMm: number;
};

export const MATERIAL_RECIPE_FIELDS = [
  'mode',
  'minPower',
  'power',
  'speed',
  'passes',
  'airAssist',
  'kerfOffsetMm',
  'tabsEnabled',
  'tabSizeMm',
  'tabsPerShape',
  'tabSkipInnerShapes',
  'hatchAngleDeg',
  'hatchSpacingMm',
  'fillOverscanMm',
  'fillStyle',
  'fillBidirectional',
  'fillCrossHatch',
  'ditherAlgorithm',
  'linesPerMm',
  'negativeImage',
  'passThrough',
  'dotWidthCorrectionMm',
] as const satisfies ReadonlyArray<keyof MaterialRecipe>;

const LAYER_MODES = ['line', 'fill', 'image'] as const satisfies ReadonlyArray<LayerMode>;
const FILL_STYLES = ['scanline', 'offset', 'island'] as const satisfies ReadonlyArray<
  NonNullable<Layer['fillStyle']>
>;
const MIN_SPACING = 0.001;

export function captureMaterialRecipe(layer: Layer): MaterialRecipe {
  return {
    mode: layer.mode,
    minPower: layer.minPower,
    power: layer.power,
    speed: layer.speed,
    passes: layer.passes,
    airAssist: layer.airAssist,
    kerfOffsetMm: layer.kerfOffsetMm,
    tabsEnabled: layer.tabsEnabled,
    tabSizeMm: layer.tabSizeMm,
    tabsPerShape: layer.tabsPerShape,
    tabSkipInnerShapes: layer.tabSkipInnerShapes,
    hatchAngleDeg: layer.hatchAngleDeg,
    hatchSpacingMm: layer.hatchSpacingMm,
    fillOverscanMm: layer.fillOverscanMm,
    fillStyle: layer.fillStyle,
    fillBidirectional: layer.fillBidirectional,
    fillCrossHatch: layer.fillCrossHatch,
    ditherAlgorithm: layer.ditherAlgorithm,
    linesPerMm: layer.linesPerMm,
    negativeImage: layer.negativeImage,
    passThrough: layer.passThrough,
    dotWidthCorrectionMm: layer.dotWidthCorrectionMm,
  };
}

export function materialRecipePatch(recipe: MaterialRecipe): MaterialRecipe {
  return { ...normalizeMaterialRecipe(recipe), airAssist: recipe.airAssist === true };
}

export function applyMaterialRecipe(layer: Layer, recipe: MaterialRecipe): Layer {
  return {
    ...layer,
    ...materialRecipePatch(recipe),
  };
}

export function normalizeMaterialRecipe(recipe: MaterialRecipe): MaterialRecipe {
  const power = clampFinite(recipe.power, 0, 100);

  return {
    mode: recipe.mode,
    minPower: clampFinite(recipe.minPower, 0, power),
    power,
    speed: Math.max(1, finiteOr(recipe.speed, 1)),
    passes: Math.max(1, Math.floor(finiteOr(recipe.passes, 1))),
    ...(recipe.airAssist !== undefined ? { airAssist: recipe.airAssist } : {}),
    kerfOffsetMm: finiteOr(recipe.kerfOffsetMm ?? 0, 0),
    tabsEnabled: recipe.tabsEnabled === true,
    tabSizeMm: Math.max(0.01, finiteOr(recipe.tabSizeMm ?? 0.5, 0.5)),
    tabsPerShape: Math.max(1, Math.floor(finiteOr(recipe.tabsPerShape ?? 4, 4))),
    tabSkipInnerShapes: recipe.tabSkipInnerShapes !== false,
    hatchAngleDeg: finiteOr(recipe.hatchAngleDeg, 0),
    hatchSpacingMm: Math.max(MIN_SPACING, finiteOr(recipe.hatchSpacingMm, MIN_SPACING)),
    fillOverscanMm: Math.max(0, finiteOr(recipe.fillOverscanMm, 0)),
    fillStyle: isFillStyle(recipe.fillStyle) ? recipe.fillStyle : 'scanline',
    fillBidirectional: recipe.fillBidirectional,
    fillCrossHatch: recipe.fillCrossHatch,
    ditherAlgorithm: recipe.ditherAlgorithm,
    linesPerMm: Math.max(MIN_SPACING, finiteOr(recipe.linesPerMm, MIN_SPACING)),
    negativeImage: recipe.negativeImage,
    passThrough: recipe.passThrough,
    dotWidthCorrectionMm: Math.max(0, finiteOr(recipe.dotWidthCorrectionMm, 0)),
  };
}

export function isMaterialRecipe(value: unknown): value is MaterialRecipe {
  if (!isRecord(value)) {
    return false;
  }

  return hasRecipeModes(value) && hasRecipeNumbers(value) && hasRecipeBooleans(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLayerMode(value: unknown): value is LayerMode {
  return LAYER_MODES.some((mode) => mode === value);
}

function isDitherAlgorithm(value: unknown): value is DitherAlgorithm {
  return DITHER_ALGORITHMS.some((algorithm) => algorithm === value);
}

function hasRecipeModes(value: Record<string, unknown>): boolean {
  return isLayerMode(value.mode) && isDitherAlgorithm(value.ditherAlgorithm);
}

function hasRecipeNumbers(value: Record<string, unknown>): boolean {
  return (
    hasPowerNumbers(value) &&
    hasMotionNumbers(value) &&
    hasRasterNumbers(value) &&
    hasRecipeFillStyle(value)
  );
}

function hasPowerNumbers(value: Record<string, unknown>): boolean {
  return isValidPower(value.power) && isValidPower(value.minPower) && value.minPower <= value.power;
}

function hasMotionNumbers(value: Record<string, unknown>): boolean {
  return (
    isPositiveFinite(value.speed) &&
    isPositiveInteger(value.passes) &&
    (value.kerfOffsetMm === undefined || isFiniteNumber(value.kerfOffsetMm)) &&
    (value.tabSizeMm === undefined || isPositiveFinite(value.tabSizeMm)) &&
    (value.tabsPerShape === undefined || isPositiveInteger(value.tabsPerShape)) &&
    isFiniteNumber(value.hatchAngleDeg) &&
    isPositiveFinite(value.hatchSpacingMm) &&
    isNonNegativeFinite(value.fillOverscanMm)
  );
}

function hasRecipeFillStyle(value: Record<string, unknown>): boolean {
  return value.fillStyle === undefined || isFillStyle(value.fillStyle);
}

function isFillStyle(value: unknown): value is NonNullable<Layer['fillStyle']> {
  return FILL_STYLES.some((fillStyle) => fillStyle === value);
}

function hasRasterNumbers(value: Record<string, unknown>): boolean {
  return isPositiveFinite(value.linesPerMm) && isNonNegativeFinite(value.dotWidthCorrectionMm);
}

function hasRecipeBooleans(value: Record<string, unknown>): boolean {
  return (
    typeof value.fillBidirectional === 'boolean' &&
    typeof value.fillCrossHatch === 'boolean' &&
    (value.airAssist === undefined || typeof value.airAssist === 'boolean') &&
    (value.tabsEnabled === undefined || typeof value.tabsEnabled === 'boolean') &&
    (value.tabSkipInnerShapes === undefined || typeof value.tabSkipInnerShapes === 'boolean') &&
    typeof value.negativeImage === 'boolean' &&
    typeof value.passThrough === 'boolean'
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidPower(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 100;
}

function isPositiveFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 1;
}

function clampFinite(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finiteOr(value, min)));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
