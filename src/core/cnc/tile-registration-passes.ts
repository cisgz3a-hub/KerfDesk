import type { CncPass } from '../job';
import type { Vec2 } from '../scene';
import type { CncTileRegistration } from '../scene/machine';
import { zPassDepths } from './depth-passes';

/** Cylindrical bore: center pecks for a matching cutter; otherwise clear
 * concentric circles from the center outward at every requested Z step.
 * Radial pitch is at most the cutter radius so successive swept disks overlap. */
export function tileRegistrationPasses(
  center: Vec2,
  settings: CncTileRegistration,
  toolDiameterMm: number,
): ReadonlyArray<CncPass> {
  const depths = zPassDepths(settings.depthMm, settings.depthPerPassMm);
  const wallRadius = (settings.holeDiameterMm - toolDiameterMm) / 2;
  if (wallRadius === 0) {
    const points = [{ ...center, z: 0 }];
    for (const [index, depth] of depths.entries()) {
      points.push({ ...center, z: depth });
      if (index < depths.length - 1) points.push({ ...center, z: 0 });
    }
    return [{ kind: 'path3d', closed: false, points }];
  }
  const ringCount = tileRegistrationRingCount(settings.holeDiameterMm, toolDiameterMm);
  const passes: CncPass[] = [];
  let previousDepth = 0;
  for (const depth of depths) {
    passes.push({
      kind: 'path3d',
      closed: false,
      points: [
        { ...center, z: previousDepth },
        { ...center, z: depth },
      ],
    });
    for (let ring = 1; ring <= ringCount; ring += 1) {
      const radius = (wallRadius * ring) / ringCount;
      const start = { x: center.x + radius, y: center.y };
      passes.push({
        kind: 'arc',
        center,
        start,
        end: start,
        clockwise: true,
        zMm: depth,
        closed: true,
      });
    }
    previousDepth = depth;
  }
  return passes;
}

/** Shared exact count for generation and pre-allocation representation checks. */
export function tileRegistrationRingCount(holeDiameterMm: number, toolDiameterMm: number): number {
  const wallRadius = (holeDiameterMm - toolDiameterMm) / 2;
  return Math.ceil(wallRadius / (toolDiameterMm / 2));
}
