// LightBurn-style trace dialog settings — the operator-facing control model
// (Cutoff / Threshold brightness band, Ignore Less Than, Smoothness,
// Optimize, Trace Transparency, Sketch Trace). These map onto TraceOptions
// at the dialog boundary (src/ui/trace/) and feed every trace backend; they
// are backend-neutral and were split out of the now-removed potrace
// parameter module (ADR-123) so the dialog model outlived potrace's
// deletion.

export type LightBurnTraceSettings = {
  readonly cutoffLuma?: number;
  readonly thresholdLuma?: number;
  readonly ignoreLessThanPixels?: number;
  readonly smoothness?: number;
  readonly optimize?: number;
  readonly traceTransparency?: boolean;
  readonly sketchTrace?: boolean;
};

// LightBurn's documented Trace defaults (docs.lightburnsoftware.com Trace
// Image): brightness band 0..128, Ignore Less Than 2, Smoothness 1.0,
// Optimize 0.2, transparency and sketch off.
export const DEFAULT_LIGHTBURN_TRACE_SETTINGS = {
  cutoffLuma: 0,
  thresholdLuma: 128,
  ignoreLessThanPixels: 2,
  smoothness: 1,
  optimize: 0.2,
  traceTransparency: false,
  sketchTrace: false,
} as const satisfies Required<LightBurnTraceSettings>;
