import { assertNever } from '../scene';
import type { CncGroup, CncPass, Group, Job } from './job';

export type JobCoordinateValue = { readonly path: string; readonly value: number };

export function jobCoordinateValues(job: Job): ReadonlyArray<JobCoordinateValue> {
  const values: JobCoordinateValue[] = [];
  job.groups.forEach((group, index) => collectGroupCoordinates(group, index, values));
  return values;
}

function collectGroupCoordinates(
  group: Group,
  groupIndex: number,
  values: JobCoordinateValue[],
): void {
  const path = `groups[${groupIndex}]`;
  switch (group.kind) {
    case 'cut':
    case 'fill':
      group.segments.forEach((segment, segmentIndex) =>
        segment.polyline.forEach((point, pointIndex) =>
          pushPoint(values, `${path}.segments[${segmentIndex}].polyline[${pointIndex}]`, point),
        ),
      );
      return;
    case 'raster':
      collectRasterCoordinates(group, path, values);
      return;
    case 'cnc':
      collectCncCoordinates(group, path, values);
      return;
    default:
      assertNever(group, 'Group');
  }
}

function collectRasterCoordinates(
  group: Extract<Group, { readonly kind: 'raster' }>,
  path: string,
  values: JobCoordinateValue[],
): void {
  const { minX, minY, maxX, maxY } = group.bounds;
  const offset = group.initialXOffsetMm ?? 0;
  values.push(
    { path: `${path}.bounds.minX`, value: minX },
    { path: `${path}.bounds.minY`, value: minY },
    { path: `${path}.bounds.maxX`, value: maxX },
    { path: `${path}.bounds.maxY`, value: maxY },
    { path: `${path}.sweep.minX`, value: minX - group.overscanMm + offset },
    { path: `${path}.sweep.maxX`, value: maxX + group.overscanMm + offset },
  );
}

function collectCncCoordinates(group: CncGroup, path: string, values: JobCoordinateValue[]): void {
  values.push({ path: `${path}.safeZMm`, value: group.safeZMm });
  if (group.parkXMm !== undefined) values.push({ path: `${path}.parkXMm`, value: group.parkXMm });
  if (group.parkYMm !== undefined) values.push({ path: `${path}.parkYMm`, value: group.parkYMm });
  group.passes.forEach((pass, index) =>
    collectCncPassCoordinates(pass, `${path}.passes[${index}]`, values),
  );
}

function collectCncPassCoordinates(
  pass: CncPass,
  path: string,
  values: JobCoordinateValue[],
): void {
  switch (pass.kind) {
    case 'contour':
      values.push({ path: `${path}.zMm`, value: pass.zMm });
      pass.polyline.forEach((point, index) =>
        pushPoint(values, `${path}.polyline[${index}]`, point),
      );
      return;
    case 'path3d':
      pass.points.forEach((point, index) => pushPoint(values, `${path}.points[${index}]`, point));
      return;
    case 'arc':
      pushPoint(values, `${path}.start`, pass.start);
      pushPoint(values, `${path}.end`, pass.end);
      collectArcCoordinates(pass, path, values);
      return;
    case 'helical-contour':
      pushPoint(values, `${path}.start`, pass.start);
      values.push({ path: `${path}.startZMm`, value: pass.startZMm });
      collectArcCoordinates(pass, path, values);
      pass.polyline.forEach((point, index) =>
        pushPoint(values, `${path}.polyline[${index}]`, point),
      );
      return;
    default:
      assertNever(pass, 'CncPass');
  }
}

function collectArcCoordinates(
  pass: Extract<CncPass, { readonly kind: 'arc' | 'helical-contour' }>,
  path: string,
  values: JobCoordinateValue[],
): void {
  pushPoint(values, `${path}.center`, pass.center);
  values.push(
    { path: `${path}.zMm`, value: pass.zMm },
    { path: `${path}.i`, value: pass.center.x - pass.start.x },
    { path: `${path}.j`, value: pass.center.y - pass.start.y },
  );
}

function pushPoint(
  values: JobCoordinateValue[],
  path: string,
  point: { readonly x: number; readonly y: number; readonly z?: number },
): void {
  values.push({ path: `${path}.x`, value: point.x }, { path: `${path}.y`, value: point.y });
  if (point.z !== undefined) values.push({ path: `${path}.z`, value: point.z });
}

export function gcodeCoordinateFailure(job: Job): JobCoordinateValue | null {
  for (const coordinate of jobCoordinateValues(job)) {
    if (!Number.isFinite(coordinate.value)) return coordinate;
    const formatted = coordinate.value.toFixed(3);
    if (!/^-?\d+\.\d{3}$/u.test(formatted)) return coordinate;
  }
  return null;
}
