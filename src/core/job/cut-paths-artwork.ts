// Generate Path From Cut (LightBurn's Convert to Cut / Generate Path From
// Cut): the moves a compiled laser job actually burns, kerf offsets, tabs,
// perforation dashes, overcuts and fill lines included, as editable artwork.
// Line and fill groups carry their polylines in machine coordinates; the
// caller maps them back onto the bed. Image engraving is pixels, not paths,
// so raster groups are counted and left out, as are CNC groups.

import type { ColoredPath, Polyline, Vec2 } from '../scene';
import type { Job } from './job';
import { buildToolpath } from './toolpath';
import type { BuildToolpathOptions } from './toolpath-types';

export type CutPathsArtwork = {
  /** One path per operation colour, in burn order. */
  readonly paths: ReadonlyArray<ColoredPath>;
  readonly skippedRasterGroups: number;
};

export function cutPathsArtwork(
  job: Job,
  toScene: (machine: Vec2) => Vec2,
  options: BuildToolpathOptions = {},
): CutPathsArtwork {
  const byColor = new Map<string, Polyline[]>();
  const skippedRasterGroups = job.groups.filter((group) => group.kind === 'raster').length;
  const groups = job.groups.filter(
    (group) => (group.kind === 'cut' || group.kind === 'fill') && group.power > 0,
  );
  // Share the preview's final-pass, arc and calibrated fill sweep expansion.
  for (const step of buildToolpath({ ...job, groups }, options).steps) {
    if (step.kind !== 'cut' || step.polyline.length < 2) continue;
    const lines = byColor.get(step.color) ?? [];
    const points = step.polyline.map(toScene);
    const first = points[0] as Vec2;
    const last = points[points.length - 1] as Vec2;
    lines.push({
      points,
      closed: points.length > 2 && Math.hypot(last.x - first.x, last.y - first.y) < 1e-8,
    });
    byColor.set(step.color, lines);
  }
  const paths = [...byColor]
    .filter(([, polylines]) => polylines.length > 0)
    .map(([color, polylines]) => ({ color, polylines }));
  return { paths, skippedRasterGroups };
}
