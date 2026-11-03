// How far a saved CNC job's cut moved when the Job Origin anchor began to
// count every contour the operation cuts (ADR-327 Amendment 1's implementation
// correction, after 1.0.28). A crossing loop on a Pocket or V-carve, or a flat
// contour on Drill, is cut but was left out of the anchor, so 1.0.28 placed
// such a job off its canvas anchor. The new place is the right one; an
// operator who clamped stock to suit the old cut is told how far it moved
// (rolling audit v9 R8-P2-1). Absolute does not anchor, so it never moves.

import { artworkOperationRuns } from '../artwork-order';
import { anchorPointForOrigin } from '../job/job-origin';
import type { Bounds, Project, Vec2 } from '../scene';
import { cncOperationDesignBounds, type DesignBoundsRule } from './cnc-design-bounds';
import { collectLayerPolylines } from './collect-cnc-contours';

const SAME_MM = 0.0005;

/** The machine-coordinate move of the cut, new place minus the 1.0.28 place,
 * or null when the job anchors nowhere or did not move. */
export function cncAnchorShiftSince1028(project: Project): Vec2 | null {
  if (project.machine?.kind !== 'cnc') return null;
  const placement = project.jobSetup.placement;
  if (placement.startFrom === 'absolute') return null;
  const now = jobDesignBounds(project, 'current');
  const before = jobDesignBounds(project, 'release-1.0.28');
  if (now === null || before === null) return null;
  const origin = project.device.origin;
  const anchorNow = anchorPointForOrigin(now, placement.anchor, origin);
  const anchorBefore = anchorPointForOrigin(before, placement.anchor, origin);
  // The program is shifted so the anchor lands on the origin, so the cut
  // moves opposite to the anchor.
  const shift = { x: anchorBefore.x - anchorNow.x, y: anchorBefore.y - anchorNow.y };
  return Math.abs(shift.x) < SAME_MM && Math.abs(shift.y) < SAME_MM ? null : shift;
}

function jobDesignBounds(project: Project, rule: DesignBoundsRule): Bounds | null {
  const { scene, device } = project;
  let union: Bounds | null = null;
  for (const run of artworkOperationRuns(scene)) {
    let bounds: Bounds | null;
    try {
      const polylines = collectLayerPolylines(scene.objects, run.layer, device);
      bounds = cncOperationDesignBounds(polylines, scene.objects, run.layer, device, rule);
    } catch {
      // Geometry the compiler would refuse has no anchor to compare.
      return null;
    }
    if (bounds === null) continue;
    union =
      union === null
        ? bounds
        : {
            minX: Math.min(union.minX, bounds.minX),
            minY: Math.min(union.minY, bounds.minY),
            maxX: Math.max(union.maxX, bounds.maxX),
            maxY: Math.max(union.maxY, bounds.maxY),
          };
  }
  return union;
}
