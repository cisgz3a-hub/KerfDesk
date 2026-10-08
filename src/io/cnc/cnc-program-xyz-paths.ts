import type { CncReachPoint } from '../../core/cnc/cnc-reach-geometry';
import type { ToolpathStep } from '../../core/job';

type StepGeometry = { readonly points: ReadonlyArray<CncReachPoint>; readonly endZ: number };

/** Preserve parser travel Z and interpolate cut Z only within each emitted step. */
export function cncProgramXyzPaths(
  steps: Iterable<ToolpathStep>,
  initial: CncReachPoint,
): ReadonlyArray<ReadonlyArray<CncReachPoint>> {
  const paths: ReadonlyArray<CncReachPoint>[] = [[initial]];
  let z = initial.z;
  for (const step of steps) {
    const geometry = stepGeometry(step, z);
    if (geometry === null) continue;
    paths.push(geometry.points);
    z = geometry.endZ;
  }
  return paths;
}
function stepGeometry(step: ToolpathStep, z: number): StepGeometry | null {
  switch (step.kind) {
    case 'plunge':
      return {
        points: [
          { ...step.at, z: step.fromZ },
          { ...step.at, z: step.toZ },
        ],
        endZ: step.toZ,
      };
    case 'travel': {
      const endZ = step.z?.to ?? z;
      return {
        points: [
          { ...step.from, z: step.z?.from ?? z },
          { ...step.to, z: endZ },
        ],
        endZ,
      };
    }
    case 'cut':
      return cutGeometry(step, z);
    default:
      return null;
  }
}
function cutGeometry(step: Extract<ToolpathStep, { kind: 'cut' }>, z: number): StepGeometry {
  const from = step.z?.from ?? z,
    to = step.z?.to ?? from;
  return {
    points: step.polyline.map((point, index) => ({
      ...point,
      z: from + ((to - from) * index) / Math.max(1, step.polyline.length - 1),
    })),
    endZ: to,
  };
}
