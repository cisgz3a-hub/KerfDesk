// Ruler tick/label spacing, chosen from the view scale (ADR-348).
//
// The rulers used to tick every 10 mm and label every 50 mm at every zoom.
// Zoomed out that is a grey smear of ticks with labels colliding into each
// other; zoomed in on a 2 mm detail the nearest label can be off-screen, so
// the strip says nothing about where you are. Spacing therefore follows the
// scale: pick the smallest "nice" number whose labels are far enough apart to
// read, then subdivide it for minor ticks.

/** A label needs this much room so "1000" never touches its neighbour. */
const MIN_LABEL_GAP_PX = 62;
/** Below this, minor ticks stop being separate marks and start being a bar. */
const MIN_MINOR_GAP_PX = 5;
/** Subdivisions tried per labelled step, densest first; 1 = no minor ticks. */
const SUBDIVISIONS: ReadonlyArray<number> = [10, 5, 4, 2, 1];

export type RulerSteps = {
  /** Millimetres between labelled (major) ticks. */
  readonly labelMm: number;
  /** Millimetres between unlabelled (minor) ticks; equals labelMm when none fit. */
  readonly minorMm: number;
  /** How many minor intervals make one labelled step. */
  readonly subdivisions: number;
};

/** `scale` is canvas px per scene mm (ViewTransform.scale). */
export function rulerSteps(scale: number): RulerSteps {
  const pxPerMm = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const labelMm = niceStep(MIN_LABEL_GAP_PX / pxPerMm);
  const subdivisions =
    SUBDIVISIONS.find((count) => (labelMm / count) * pxPerMm >= MIN_MINOR_GAP_PX) ?? 1;
  return { labelMm, minorMm: labelMm / subdivisions, subdivisions };
}

/**
 * The smallest 1-2-5-per-decade number that is at least `minimumMm`, so the
 * step is always something an operator reads as a round number — 20 mm, not
 * 17.3 — at any zoom, with no ladder to run off the end of.
 */
function niceStep(minimumMm: number): number {
  const floor = Math.max(0.01, minimumMm);
  const decade = Math.pow(10, Math.floor(Math.log10(floor)));
  for (const multiple of [1, 2, 5]) {
    if (decade * multiple >= floor - decade * 1e-9) return decade * multiple;
  }
  return decade * 10;
}

/** Ruler labels are read at a glance: no trailing zeros, no exponent. */
export function formatRulerLabel(mm: number): string {
  const rounded = Math.abs(mm) < 1e-9 ? 0 : mm;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
