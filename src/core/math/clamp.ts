// Shared numeric clamp — bound a value to [min, max]. Extracted from five
// verbatim core copies (camera-profile, object-power-scale, edge-trace,
// trace-boundary, compile-job-raster) so the primitive lives in one place
// instead of drifting in copy-paste.
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
