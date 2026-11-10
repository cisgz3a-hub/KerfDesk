// What the playback scrubber shows along its track (ADR-701): which stretches
// of the program's time cut, travel, or plunge and retract. The track is a few
// hundred pixels wide, so the time is divided into a fixed number of bins and
// each bin takes the kind that spent the most time in it; neighbouring bins of
// one kind merge into a band. One pass over the moves, whatever their count.

import { SEG_KIND } from '../../core/gcode-view';

export type TimelineBandKind = 'cut' | 'travel' | 'other';

export type TimelineBand = {
  readonly kind: TimelineBandKind;
  /** Start and end as fractions (0-1) of the program's motion time. */
  readonly from: number;
  readonly to: number;
};

const KINDS: ReadonlyArray<TimelineBandKind> = ['cut', 'travel', 'other'];
const DEFAULT_BINS = 240;

function bandKind(segKind: number | undefined): number {
  if (segKind === SEG_KIND.cut) return 0;
  if (segKind === SEG_KIND.travel) return 1;
  return 2;
}

/** Bands across the program's motion time; empty when it has none. */
export function timelineBands(
  model: { readonly segmentCount: number; readonly segKind: ArrayLike<number> },
  segTimeEndSec: ArrayLike<number>,
  totalSeconds: number,
  bins: number = DEFAULT_BINS,
): ReadonlyArray<TimelineBand> {
  if (!(totalSeconds > 0) || model.segmentCount <= 0 || bins <= 0) return [];
  const seconds = binSeconds(model, segTimeEndSec, totalSeconds, bins);
  const bands: TimelineBand[] = [];
  for (let bin = 0; bin < bins; bin += 1) {
    const kind = dominantKind(seconds, bin);
    if (kind === null) continue;
    const from = bin / bins;
    const to = (bin + 1) / bins;
    const last = bands[bands.length - 1];
    if (last !== undefined && last.kind === kind && last.to === from) {
      bands[bands.length - 1] = { kind, from: last.from, to };
    } else {
      bands.push({ kind, from, to });
    }
  }
  return bands;
}

// Seconds each kind spends in each bin: bins × 3, kind-minor.
function binSeconds(
  model: { readonly segmentCount: number; readonly segKind: ArrayLike<number> },
  segTimeEndSec: ArrayLike<number>,
  totalSeconds: number,
  bins: number,
): Float64Array {
  const seconds = new Float64Array(bins * KINDS.length);
  const binWidth = totalSeconds / bins;
  let start = 0;
  for (let index = 0; index < model.segmentCount; index += 1) {
    const end = Math.min(totalSeconds, segTimeEndSec[index] ?? start);
    if (end > start) {
      const kind = bandKind(model.segKind[index]);
      let bin = Math.min(bins - 1, Math.floor(start / binWidth));
      let at = start;
      while (at < end && bin < bins) {
        const binEnd = Math.min(end, (bin + 1) * binWidth);
        const slot = bin * KINDS.length + kind;
        seconds[slot] = (seconds[slot] ?? 0) + (binEnd - at);
        at = binEnd;
        bin += 1;
      }
    }
    start = Math.max(start, end);
  }
  return seconds;
}

function dominantKind(seconds: Float64Array, bin: number): TimelineBandKind | null {
  let best: TimelineBandKind | null = null;
  let most = 0;
  KINDS.forEach((kind, offset) => {
    const value = seconds[bin * KINDS.length + offset] ?? 0;
    if (value > most) {
      most = value;
      best = kind;
    }
  });
  return best;
}

/** The bands as a CSS gradient over the track; colours are the viewer's tokens. */
export function timelineBandsGradient(bands: ReadonlyArray<TimelineBand>): string | undefined {
  if (bands.length === 0) return undefined;
  const stops = bands.map((band) => {
    const color = `var(--lf-viewer-band-${band.kind})`;
    return `${color} ${percent(band.from)} ${percent(band.to)}`;
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

function percent(fraction: number): string {
  return `${Number((fraction * 100).toFixed(3))}%`;
}
