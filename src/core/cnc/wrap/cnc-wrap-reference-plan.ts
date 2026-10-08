import type { Job, CncGroup, CncPass } from '../../job/job';
import type { CncWrapStudy } from '../../scene/cnc-wrap-study';
import type { Vec3 } from '../../geometry/vec3';
import { CNC_WRAP_REFERENCE_CAPABILITY } from './cnc-wrap-capabilities';
export type CncWrapPoint = {
  readonly axialMm: number;
  readonly angleDeg: number;
  readonly radialZMm: number;
};
export type CncWrapReferencePath = {
  readonly operationId: string;
  readonly toolId: string;
  readonly toolName: string;
  readonly spindleRpm: number;
  readonly spindleSpinupSec: number;
  readonly feedMmPerMin: number;
  readonly plungeMmPerMin: number;
  readonly points: readonly CncWrapPoint[];
};
export type CncWrapReferencePlan = {
  readonly kind: 'offline-wrap-reference-v1';
  readonly qualification: 'reference-model-only';
  readonly capability: typeof CNC_WRAP_REFERENCE_CAPABILITY;
  readonly setup: CncWrapStudy;
  readonly linearAxis: 'X' | 'Y';
  readonly paths: readonly CncWrapReferencePath[];
  readonly warnings: readonly string[];
};
export type CncWrapPlanResult =
  | { readonly kind: 'ok'; readonly plan: CncWrapReferencePlan }
  | { readonly kind: 'unavailable'; readonly reason: string };
export function mapCncWrapPoint(point: Vec3, setup: CncWrapStudy): CncWrapPoint {
  const circumferential = point[setup.circumferentialAxis];
  const axial = point[setup.circumferentialAxis === 'x' ? 'y' : 'x'];
  return {
    axialMm: axial + setup.axialDatumMm,
    angleDeg:
      setup.rotaryDatumDeg +
      (setup.direction * (circumferential - setup.seamMm) * 180) / (Math.PI * setup.radiusMm),
    radialZMm: point.z,
  };
}
export function cncWrapSegmentLength(a: CncWrapPoint, b: CncWrapPoint, radiusMm: number): number {
  // Conservative surface metric uses the greater radial envelope for changing depths.
  const radius = radiusMm + Math.max(a.radialZMm, b.radialZMm);
  return Math.hypot(
    b.axialMm - a.axialMm,
    ((b.angleDeg - a.angleDeg) * Math.PI * radius) / 180,
    b.radialZMm - a.radialZMm,
  );
}
export function planCncWrapReference(job: Job, setup: CncWrapStudy): CncWrapPlanResult {
  if (setup.capabilityId !== CNC_WRAP_REFERENCE_CAPABILITY.id)
    return { kind: 'unavailable', reason: 'No reference post declares this capability.' };
  if (!validWrapSetupNumbers(setup))
    return {
      kind: 'unavailable',
      reason:
        'Wrap planning requires finite positive radius and clearance and finite bounded datums.',
    };
  const paths: CncWrapReferencePath[] = [];
  let vertices = 0;
  for (const group of job.groups) {
    if (group.kind !== 'cnc')
      return {
        kind: 'unavailable',
        reason: 'CNC wrapping does not accept laser or raster groups.',
      };
    const issue = wrapGroupIssue(group);
    if (issue !== null) return { kind: 'unavailable', reason: issue };
    for (const pass of group.passes) {
      const points = wrapPassPoints(pass);
      if (points === null)
        return {
          kind: 'unavailable',
          reason:
            'The reference planner supports explicit linear paths only. Native arcs and helical paths need their own wrap qualification.',
        };
      vertices += points.length;
      if (vertices > 100_000)
        return {
          kind: 'unavailable',
          reason:
            'Wrap planning exceeds the 100,000 vertex budget; no partial reference program was produced.',
        };
      const checked = checkedReferencePath(group, points, setup);
      if (checked.kind === 'unavailable') return checked;
      paths.push(checked.path);
    }
  }
  if (paths.length === 0)
    return { kind: 'unavailable', reason: 'No supported CNC contours are available.' };
  return {
    kind: 'ok',
    plan: {
      kind: 'offline-wrap-reference-v1',
      qualification: 'reference-model-only',
      capability: CNC_WRAP_REFERENCE_CAPABILITY,
      setup,
      linearAxis: setup.circumferentialAxis === 'x' ? 'Y' : 'X',
      paths,
      warnings: [
        'Offline reference only. No controller firmware or physical machine/accessory is qualified.',
        'Coordinates describe a cutter-tip locus; cutter-envelope contact, rotary limits, fixture clearance and backlash remain unqualified.',
        'The angular coordinate is unwrapped continuously. A seam crossing does not choose the shortest rotary route.',
        'Changing-depth segments use the greater endpoint radius for conservative inverse-time duration; this is a planning approximation.',
        'Only explicit linear profile-on-path end-mill contours are supported. No laser rotary, pockets, relief, arbitrary vendor posts or automatic tool changes.',
      ],
    },
  };
}
function wrapGroupIssue(group: CncGroup): string | null {
  if (group.cutType !== 'profile-on-path' || group.toolKind !== 'end-mill')
    return 'Only a declared end-mill profile-on-path operation is supported by this reference planner.';
  if (group.toolId === undefined) return 'The exact tool ID must be resolved before wrap planning.';
  if ((group.coolant ?? 'off') !== 'off')
    return 'Coolant transitions have no qualified wrap reference contract.';
  if (
    ![group.feedMmPerMin, group.plungeMmPerMin, group.spindleRpm].every(
      (v) => Number.isFinite(v) && v > 0,
    )
  )
    return 'Wrap planning requires positive finite feed, plunge and spindle values.';
  return null;
}
function wrapPassPoints(pass: CncPass): readonly Vec3[] | null {
  if (pass.kind === 'contour')
    return closeWrapPath(
      pass.polyline.map((p) => ({ ...p, z: pass.zMm })),
      pass.closed,
    );
  if (pass.kind === 'path3d') return closeWrapPath(pass.points, pass.closed);
  return null;
}

function referencePath(
  group: CncGroup,
  points: readonly Vec3[],
  setup: CncWrapStudy,
): CncWrapReferencePath {
  return {
    operationId: group.layerId,
    toolId: group.toolId ?? '',
    toolName: group.toolName ?? group.toolId ?? '',
    spindleRpm: group.spindleRpm,
    spindleSpinupSec: group.spindleSpinupSec,
    feedMmPerMin: group.feedMmPerMin,
    plungeMmPerMin: group.plungeMmPerMin,
    points: points.map((p) => mapCncWrapPoint(p, setup)),
  };
}

function closeWrapPath(points: readonly Vec3[], closed: boolean): readonly Vec3[] {
  const first = points[0],
    last = points.at(-1);
  if (!closed || first === undefined || last === undefined) return points;
  return first.x === last.x && first.y === last.y && first.z === last.z
    ? points
    : [...points, first];
}

function validWrapSetupNumbers(setup: CncWrapStudy): boolean {
  return (
    [setup.radiusMm, setup.radialClearanceMm].every(
      (value) => Number.isFinite(value) && value > 0 && value <= 100_000,
    ) &&
    [setup.seamMm, setup.rotaryDatumDeg, setup.axialDatumMm].every(
      (value) => Number.isFinite(value) && Math.abs(value) <= 1_000_000,
    )
  );
}
function finiteWrapCoordinates(path: CncWrapReferencePath): boolean {
  return path.points.every((point) =>
    [point.axialMm, point.angleDeg, point.radialZMm].every(Number.isFinite),
  );
}

function checkedReferencePath(
  group: CncGroup,
  points: readonly Vec3[],
  setup: CncWrapStudy,
):
  | { readonly kind: 'ok'; readonly path: CncWrapReferencePath }
  | { readonly kind: 'unavailable'; readonly reason: string } {
  if (
    points.some(
      (point) => !Number.isFinite(point.x + point.y + point.z) || setup.radiusMm + point.z <= 0,
    )
  )
    return {
      kind: 'unavailable',
      reason:
        'A wrap path reaches or crosses the cylinder axis or contains non-finite coordinates.',
    };
  const path = referencePath(group, points, setup);
  if (!finiteWrapCoordinates(path))
    return { kind: 'unavailable', reason: 'Mapped rotary or linear coordinates are not finite.' };
  return { kind: 'ok', path };
}
