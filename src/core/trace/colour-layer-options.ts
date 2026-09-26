// Colour-layer trace options (ADR-402). Kept in their own module so the
// TraceOptions type can reference them without importing the backend.

/** How each colour's filled paths relate to the others.
 *  - 'cut-out': an exact partition. Every colour owns only its own pixels;
 *    neighbouring colours share one boundary with no gap and no overlap.
 *  - 'stacked': colours are stacked from the lightest (bottom) to the darkest
 *    (top) and each colour also covers the areas of every darker colour
 *    stacked above it, so its outline never needs to follow the colours on
 *    top of it. The boundaries are the same shared curves as 'cut-out'. */
export type ColourLayerOutput = 'cut-out' | 'stacked';

export type ColourLayerOptions = {
  /** Maximum palette size INCLUDING the background colour, 2..8. Undefined
   *  picks the count automatically (flat-colour clustering, then merging of
   *  colours closer than a visible difference). */
  readonly colours?: number;
  readonly output?: ColourLayerOutput;
  /** Trace the detected paper/background colour as a layer too. */
  readonly keepBackground?: boolean;
};

export const MIN_COLOUR_LAYERS = 2;
export const MAX_COLOUR_LAYERS = 8;

/** Clamp a requested colour count to the supported 2..8 range; undefined or
 *  non-finite values mean automatic. */
export function normalizedColourCount(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(MIN_COLOUR_LAYERS, Math.min(MAX_COLOUR_LAYERS, Math.round(value)));
}
