// Rotary surface feed (ADR-127 Amendment 2, rolling audit v12 X8-P1-1).
//
// A Y-port rotary runs the job in machine space: X stays surface mm, Y is
// scaled by k machine mm per surface mm (`Job.rotarySurfaceYScale`). GRBL,
// grblHAL, FluidNC, Marlin and Smoothieware all time a G1 by the length of its
// commanded XYZ vector, so a move of (dx, k·dy) at F takes hypot(dx, k·dy)/F
// minutes while the part's surface travels hypot(dx, dy). Writing the layer
// speed unchanged moved the surface at F·Ls/Lm: 6.3x too fast round an Ø80
// glass in the Creality chuck. Each move instead gets F·Lm/Ls, so the surface
// moves at the layer speed in every direction. A move along X (every image
// row) has Lm = Ls and keeps F exactly.
//
// On a taper (ADR-694) the warp scales Y by f(x) = R_ref / r(x) before k, so
// the local machine Y per surface mm at a move is k · f(x): the part turns
// ΔY / (k · R_ref) rad and its surface at radius r(x) moves ΔY / (k · f(x)).

import type { Job } from '../job';
import { rotaryTaperYFactorAt, type RotaryTaperProfile } from '../job/rotary-taper-profile';

export type RotaryFeedMatch = {
  /** Machine Y mm per surface mm (the rotary's Y scale, k). */
  readonly yScale: number;
  /** The device's feed ceiling; a k > 1 roller cannot ask for more. */
  readonly maxFeedMmPerMin: number;
  /** The cone of a tapered part (ADR-694); k then varies with X. */
  readonly taper?: RotaryTaperProfile | undefined;
};

/** The feed match for a machine-space rotary job with vector burns, or
 * undefined for any other job, whose output must stay byte-identical. Image
 * rows run along X (ADR-492 item 9), so an image-only rotary job needs none. */
export function rotaryFeedMatchFor(job: Job, maxFeedMmPerMin: number): RotaryFeedMatch | undefined {
  const yScale = job.rotarySurfaceYScale ?? 1;
  const taper = job.rotaryTaper;
  if (!(yScale > 0) || !Number.isFinite(yScale)) return undefined;
  if (yScale === 1 && taper === undefined) return undefined;
  if (!job.groups.some((group) => group.kind === 'cut' || group.kind === 'fill')) return undefined;
  return { yScale, maxFeedMmPerMin, ...(taper === undefined ? {} : { taper }) };
}

/** The machine feed that moves the surface at `layerFeed` along from → to
 * (machine coordinates). Without a match, or for a zero-length move, the
 * layer feed itself. */
export function surfaceMatchedFeed(
  layerFeed: number,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  match: RotaryFeedMatch | undefined,
): number {
  if (match === undefined) return layerFeed;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const machineMm = Math.hypot(dx, dy);
  const localScale = match.yScale * rotaryTaperYFactorAt(match.taper, (from.x + to.x) / 2);
  const surfaceMm = Math.hypot(dx, dy / localScale);
  if (!(machineMm > 0) || !(surfaceMm > 0)) return layerFeed;
  const matched = (layerFeed * machineMm) / surfaceMm;
  const ceiling =
    Number.isFinite(match.maxFeedMmPerMin) && match.maxFeedMmPerMin > 0
      ? Math.max(layerFeed, match.maxFeedMmPerMin)
      : Number.POSITIVE_INFINITY;
  return Math.min(matched, ceiling);
}

/** The emitter contexts' optional match. */
export type RotaryFeedContext = { readonly rotaryFeed?: RotaryFeedMatch | undefined };

/** One disclosure line for the program, so a reader of the file knows why the
 * F words change between moves of one layer; nothing without a match. */
export function rotaryFeedComment(match: RotaryFeedMatch | undefined): string {
  if (match === undefined) return '';
  return `; rotary: each move's F is scaled so the part's surface moves at the layer speed (Y x${match.yScale.toFixed(4)})
`;
}
