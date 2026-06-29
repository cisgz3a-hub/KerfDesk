// Layer - one per unique stroke color in the scene. Carries the cut/engrave
// parameters (power, speed, passes) that the OutputStrategy consumes when
// emitting G-code. WORKFLOW.md F-A7 defines defaults and value ranges.

import type { DitherAlgorithm } from './scene-object';

// Phase F: 'line' = vector cut/engrave along polylines; 'fill' =
// parallel-line hatching inside closed contours (F.1); 'image' =
// raster engrave with per-pixel S modulation (F.2, ADR-020).
export type LayerMode = 'line' | 'fill' | 'image';

// F.2: dither algorithm choice for image-mode layers. Mirrors the
// pure-core enum in scene-object.ts (DitherAlgorithm) so the Layer
// type does not reach into the SceneObject module. Kept aligned;
// adding an algorithm here also needs the matching dither.ts arm.
export type LayerDitherAlgorithm = DitherAlgorithm;
export type LayerFillStyle = 'scanline' | 'offset' | 'island';

export type LayerOperationSettings = {
  readonly mode: LayerMode;
  readonly minPower: number; // 0..100 percent; grayscale image floor
  readonly power: number; // 0..100 percent
  readonly speed: number; // mm/min; capped by device.maxFeed at compile time
  readonly passes: number; // integer >= 1
  readonly airAssist: boolean;
  readonly kerfOffsetMm: number;
  readonly tabsEnabled: boolean;
  readonly tabSizeMm: number;
  readonly tabsPerShape: number;
  readonly tabSkipInnerShapes: boolean;
  readonly hatchAngleDeg: number;
  readonly hatchSpacingMm: number;
  readonly fillOverscanMm: number;
  readonly fillStyle: LayerFillStyle;
  readonly fillBidirectional: boolean;
  readonly fillCrossHatch: boolean;
  readonly ditherAlgorithm: LayerDitherAlgorithm;
  readonly linesPerMm: number;
  readonly imageBidirectional: boolean;
  readonly negativeImage: boolean;
  readonly passThrough: boolean;
  readonly dotWidthCorrectionMm: number;
};

export type LayerSubLayer = {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly settings: LayerOperationSettings;
};

export type Layer = LayerOperationSettings & {
  readonly id: string;
  readonly color: string; // lowercase 6-digit hex
  readonly visible: boolean;
  readonly output: boolean;
  readonly subLayers: ReadonlyArray<LayerSubLayer>;
};

export const LAYER_DEFAULTS = {
  mode: 'line',
  minPower: 0,
  power: 30,
  speed: 1500,
  passes: 1,
  visible: true,
  output: true,
  airAssist: false,
  kerfOffsetMm: 0,
  tabsEnabled: false,
  tabSizeMm: 0.5,
  tabsPerShape: 4,
  tabSkipInnerShapes: true,
  hatchAngleDeg: 0,
  hatchSpacingMm: 0.1,
  fillOverscanMm: 5,
  fillStyle: 'scanline',
  fillBidirectional: true,
  fillCrossHatch: false,
  ditherAlgorithm: 'floyd-steinberg',
  linesPerMm: 10,
  imageBidirectional: true,
  negativeImage: false,
  passThrough: false,
  dotWidthCorrectionMm: 0,
  subLayers: [],
} as const satisfies Omit<Layer, 'id' | 'color'>;

const LAYER_OPERATION_SETTING_KEYS = [
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
  'imageBidirectional',
  'negativeImage',
  'passThrough',
  'dotWidthCorrectionMm',
] as const satisfies ReadonlyArray<keyof LayerOperationSettings>;

export function createLayer(args: { id: string; color: string; mode?: LayerMode }): Layer {
  // mode override (F.2.c): raster-image imports want mode='image'
  // from the moment their layer is auto-created so the user does not
  // have to toggle. Other callers inherit LAYER_DEFAULTS.mode ('line').
  return {
    id: args.id,
    color: args.color,
    ...LAYER_DEFAULTS,
    ...(args.mode !== undefined ? { mode: args.mode } : {}),
  };
}

export function captureLayerOperationSettings(
  layer: LayerOperationSettings,
): LayerOperationSettings {
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
    imageBidirectional: layer.imageBidirectional,
    negativeImage: layer.negativeImage,
    passThrough: layer.passThrough,
    dotWidthCorrectionMm: layer.dotWidthCorrectionMm,
  };
}

export function createLayerSubLayer(
  layer: Layer,
  args: {
    readonly id: string;
    readonly label: string;
    readonly enabled?: boolean;
    readonly settings?: LayerOperationSettings;
  },
): LayerSubLayer {
  return {
    id: args.id,
    label: args.label,
    enabled: args.enabled ?? true,
    settings: args.settings ?? captureLayerOperationSettings(layer),
  };
}

export function layerFromSubLayer(layer: Layer, subLayer: LayerSubLayer): Layer {
  return {
    id: `${layer.id}:${subLayer.id}`,
    color: layer.color,
    visible: layer.visible,
    output: layer.output && subLayer.enabled,
    ...subLayer.settings,
    subLayers: [],
  };
}

export function outputOperationLayers(layer: Layer): ReadonlyArray<Layer> {
  return [layer, ...layer.subLayers.map((subLayer) => layerFromSubLayer(layer, subLayer))].filter(
    (operationLayer) => operationLayer.output,
  );
}

export function nextLayerSubLayerId(layer: Layer): string {
  let index = layer.subLayers.length + 1;
  const used = new Set(layer.subLayers.map((subLayer) => subLayer.id));
  while (used.has(`sub-${index}`)) index += 1;
  return `sub-${index}`;
}

export function layerOperationSettingsEqual(
  left: LayerOperationSettings,
  right: LayerOperationSettings,
): boolean {
  return LAYER_OPERATION_SETTING_KEYS.every((key) => left[key] === right[key]);
}
