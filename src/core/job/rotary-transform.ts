// applyRotaryYScale — map a compiled job's Y coordinates into rotary space
// (ADR-127 N1): scale surface mm into machine-rotation mm, then REBASE so
// the job's lowest Y sits at 0. Rotation is relative to wherever the
// cylinder currently is — the design's position on the flat-bed canvas is
// meaningless on a rotary, only its extent matters. Runs at the LAST moment
// (inside emitGcode, after prepareOutput), so previews/estimates keep
// showing surface-true geometry. Raster groups map their bounds through the
// same transform; reverse mode also reverses pixel rows so artwork mirrors.

import type { CutSegment, FillSegment, Job, RasterGroup } from './job';

// reverse (ADR-127): the rotary can spin the opposite way (chuck mounted
// backwards, or roller/gearing that inverts direction), which mirrors the
// engraving around the cylinder. reverse mirrors Y within the wrap window
// [0, extent] so the design comes out the right way round; bounds stay the
// same [0, extent] window either way.
export function applyRotaryYScale(job: Job, yScale: number, reverse = false): Job {
  const range = jobYRange(job);
  if (range === null) return job;
  if (yScale === 1 && !reverse && range.min === 0) return job;
  const extent = (range.max - range.min) * yScale;
  const map = <T extends CutSegment>(s: T): T => mapSegment(s, yScale, range.min, extent, reverse);
  return {
    groups: job.groups.map((group) => {
      if (group.kind === 'cut') return { ...group, segments: group.segments.map(map) };
      if (group.kind === 'fill') {
        return { ...group, segments: group.segments.map((s) => map(s) as FillSegment) };
      }
      if (group.kind === 'raster') {
        return mapRasterGroup(group, yScale, range.min, extent, reverse);
      }
      return group;
    }),
  };
}

function jobYRange(job: Job): { readonly min: number; readonly max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const group of job.groups) {
    if (group.kind === 'raster') {
      min = Math.min(min, group.bounds.minY);
      max = Math.max(max, group.bounds.maxY);
      continue;
    }
    if (group.kind !== 'cut' && group.kind !== 'fill') continue;
    for (const segment of group.segments) {
      for (const p of segment.polyline) {
        min = Math.min(min, p.y);
        max = Math.max(max, p.y);
      }
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function mapRasterGroup(
  group: RasterGroup,
  yScale: number,
  baseY: number,
  extent: number,
  reverse: boolean,
): RasterGroup {
  const forwardMin = (group.bounds.minY - baseY) * yScale;
  const forwardMax = (group.bounds.maxY - baseY) * yScale;
  return {
    ...group,
    bounds: {
      ...group.bounds,
      minY: reverse ? extent - forwardMax : forwardMin,
      maxY: reverse ? extent - forwardMin : forwardMax,
    },
    ...(reverse ? reverseRasterValues(group) : {}),
  };
}

function reverseRasterValues(
  group: RasterGroup,
): Pick<RasterGroup, 'sValues' | 'rowProvider' | 'rowProviderOrder'> {
  if (group.rowProvider !== undefined) {
    return {
      sValues: new Uint16Array(0),
      rowProvider: group.rowProvider,
      rowProviderOrder: group.rowProviderOrder === 'descending-y' ? 'ascending-y' : 'descending-y',
    };
  }
  const reversed = new Uint16Array(group.sValues.length);
  for (let row = 0; row < group.pixelHeight; row += 1) {
    const sourceStart = row * group.pixelWidth;
    const targetStart = (group.pixelHeight - 1 - row) * group.pixelWidth;
    reversed.set(group.sValues.subarray(sourceStart, sourceStart + group.pixelWidth), targetStart);
  }
  return { sValues: reversed };
}

function mapSegment<T extends CutSegment>(
  segment: T,
  yScale: number,
  baseY: number,
  extent: number,
  reverse: boolean,
): T {
  return {
    ...segment,
    polyline: segment.polyline.map((p) => {
      const forward = (p.y - baseY) * yScale;
      return { x: p.x, y: reverse ? extent - forward : forward };
    }),
  };
}
