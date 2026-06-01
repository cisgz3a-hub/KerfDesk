const POTRACE_MAX_ALPHA = 4 / 3;

export type PotraceTurnPolicy =
  | 'black'
  | 'white'
  | 'left'
  | 'right'
  | 'minority'
  | 'majority'
  | 'random';

export type LightBurnTraceSettings = {
  readonly cutoffLuma?: number;
  readonly thresholdLuma?: number;
  readonly ignoreLessThanPixels?: number;
  readonly smoothness?: number;
  readonly optimize?: number;
  readonly traceTransparency?: boolean;
  readonly sketchTrace?: boolean;
};

export type PotraceParams = {
  readonly turdSize: number;
  readonly turnPolicy: PotraceTurnPolicy;
  readonly alphaMax: number;
  readonly optCurve: boolean;
  readonly optTolerance: number;
};

export const DEFAULT_LIGHTBURN_TRACE_SETTINGS = {
  cutoffLuma: 0,
  thresholdLuma: 128,
  ignoreLessThanPixels: 2,
  smoothness: 1,
  optimize: 0.2,
  traceTransparency: false,
  sketchTrace: false,
} as const satisfies Required<LightBurnTraceSettings>;

export function lightBurnTraceSettingsToPotraceParams(
  settings: LightBurnTraceSettings = {},
): PotraceParams {
  const merged = { ...DEFAULT_LIGHTBURN_TRACE_SETTINGS, ...settings };
  const optimize = clampMin(merged.optimize, 0);
  return {
    turdSize: Math.round(clampMin(merged.ignoreLessThanPixels, 0)),
    turnPolicy: 'minority',
    alphaMax: clamp(merged.smoothness, 0, POTRACE_MAX_ALPHA),
    optCurve: optimize > 0,
    optTolerance: optimize,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampMin(value: number, min: number): number {
  return Math.max(min, value);
}
