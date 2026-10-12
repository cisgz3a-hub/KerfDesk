// Generate Path From Cut (LightBurn's Convert to Cut / Generate Path From
// Cut): the moves a compiled laser job actually burns, kerf offsets, tabs,
// perforation dashes, overcuts and fill lines included, as editable artwork.
// Line and fill groups carry their polylines in machine coordinates; the
// caller maps them back onto the bed. Image engraving is pixels, not paths,
// so raster groups are counted and left out, as are CNC groups.

import type { ColoredPath, Polyline, Vec2 } from '../scene';
import type { Job } from './job';

export type CutPathsArtwork = {
  /** One path per operation colour, in burn order. */
  readonly paths: ReadonlyArray<ColoredPath>;
  readonly skippedRasterGroups: number;
};

export function cutPathsArtwork(job: Job, toScene: (machine: Vec2) => Vec2): CutPathsArtwork {
  const byColor = new Map<string, Polyline[]>();
  let skippedRasterGroups = 0;
  for (const group of job.groups) {
    if (group.kind === 'raster') {
      skippedRasterGroups += 1;
      continue;
    }
    if (group.kind !== 'cut' && group.kind !== 'fill') continue;
    const lines = byColor.get(group.color) ?? [];
    for (const segment of group.segments) {
      if (segment.polyline.length < 2) continue;
      lines.push({ points: segment.polyline.map(toScene), closed: segment.closed });
    }
    byColor.set(group.color, lines);
  }
  const paths = [...byColor]
    .filter(([, polylines]) => polylines.length > 0)
    .map(([color, polylines]) => ({ color, polylines }));
  return { paths, skippedRasterGroups };
}
