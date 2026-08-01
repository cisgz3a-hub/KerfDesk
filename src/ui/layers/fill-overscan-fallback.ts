import { DEFAULT_OVERSCAN_MM } from '../../core/job';

/** Describes the stored Scan Line overscan separately from its generic effective fallback. */
export function genericRunwayFallbackText(storedOverscanMm: number): string {
  return `stored ${storedOverscanMm}; generic effective target ${DEFAULT_OVERSCAN_MM} mm`;
}
