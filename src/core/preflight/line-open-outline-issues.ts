// Open outlines on Line operations (ADR-626 Amendment 8; rolling audit
// 2026-10-21, 03-P2-9).
//
// Kerf offset, laser leads and inside-first order work on closed shapes only,
// as in LightBurn. An outline drawn as open paths whose ends meet, such as a
// CAD plate of four LINEs import could not join or lines that stop a hair
// short of each other, is cut as open lines: the kerf offset and the leads
// skip it, and the shapes inside it are not cut before it. Fill
// (offset-fill-open-contour) and CNC (cnc-open-contours-omitted) already say
// when they leave open contours out; this says it for Line, and only where one
// of those settings would have applied. Advisory only (rule 7, ADR-565): the
// lines are still cut as drawn.
//
// An outline is what Join paths makes of them at OPEN_OUTLINE_GAP_MM: open
// paths of one operation whose ends each meet one other end, closing a loop.

import { effectiveObjectPowerPercent, effectiveOperationForObject } from '../effective-output';
import { pointInPolygon } from '../geometry/point-in-polygon';
import { joinCurveEndpointsWithin, type JoinableCurve } from '../geometry/path-endpoint-join';
import { compilationPolylines } from '../job/compilation-polylines';
import { vectorPowerReachesController } from '../job/job-start-power';
import { OPEN_OUTLINE_GAP_MM } from '../job/laser-lead-open-outlines';
import { laserLeadSpecFor } from '../job/laser-lead-settings';
import {
  applyTransform,
  outputOperationLayers,
  pathUsesOperation,
  polylineToCurveSubpath,
  sceneObjectUsesOperation,
  type ColoredPath,
  type Layer,
  type Project,
  type SceneObject,
  type Vec2,
} from '../scene';
import type { PreflightIssue } from './preflight';

/** Per operation, the outlines that miss a setting and which settings. */
type OperationLines = {
  readonly name: string;
  kerf: boolean;
  leads: boolean;
  outlines: number;
  holdsShapes: boolean;
};

/** An open path, with the settings its artwork runs it with. Only paths
 * with the same operation and settings join, as in Join paths, so each
 * outline's settings are its own paths'. */
type Source = JoinableCurve & {
  readonly operationId: string;
  readonly kerf: boolean;
  readonly leads: boolean;
};

type Collected = {
  readonly sources: Source[];
  readonly operations: Map<string, OperationLines>;
  /** One point of every closed Line contour, for what an outline holds. */
  readonly probes: Vec2[];
};

export function lineOpenOutlineIssues(project: Project): ReadonlyArray<PreflightIssue> {
  const collected = collectLines(project);
  if (collected.sources.length === 0) return [];
  const { insideFirst, travelPolicy } = project.optimization;
  const ordersInsideFirst = insideFirst && travelPolicy !== 'source-order';
  const joined = joinCurveEndpointsWithin(collected.sources, OPEN_OUTLINE_GAP_MM);
  for (const [index, curve] of joined.replacements) {
    const source = collected.sources[index];
    const operation =
      source === undefined ? undefined : collected.operations.get(source.operationId);
    if (curve === null || !curve.closed || source === undefined || operation === undefined)
      continue;
    const outline = [curve.start, ...curve.segments.map((segment) => segment.to)];
    const holds =
      ordersInsideFirst && collected.probes.some((probe) => pointInPolygon(probe, outline));
    tallyOutline(operation, source, holds);
  }
  return [...collected.operations.values()].flatMap((operation) => {
    const issue = outlineIssue(operation);
    return issue === null ? [] : [issue];
  });
}

// An outline counts only when one of its own settings needs it closed.
function tallyOutline(operation: OperationLines, source: Source, holdsShapes: boolean): void {
  if (!source.kerf && !source.leads && !holdsShapes) return;
  operation.outlines += 1;
  operation.kerf ||= source.kerf;
  operation.leads ||= source.leads;
  operation.holdsShapes ||= holdsShapes;
}

function collectLines(project: Project): Collected {
  const collected: Collected = { sources: [], operations: new Map(), probes: [] };
  for (const layer of project.scene.layers) {
    for (const operation of outputOperationLayers(layer)) {
      for (const object of project.scene.objects)
        collectObject(collected, operation, object, project);
    }
  }
  return collected;
}

function collectObject(
  collected: Collected,
  operation: Layer,
  object: SceneObject,
  project: Project,
): void {
  if (!('paths' in object) || !sceneObjectUsesOperation(object, operation)) return;
  const effective = effectiveOperationForObject(operation, object);
  if (effective.mode !== 'line') return;
  const power = effectiveObjectPowerPercent(effective, object);
  if (!vectorPowerReachesController(power, project.device)) return;
  for (const path of object.paths) {
    if (!pathUsesOperation(object, path, operation)) continue;
    collected.probes.push(...closedStarts(path, object));
    if (!subpaths(path).some((subpath) => !subpath.closed)) continue;
    operationLines(collected, operation);
    const settings = {
      operationId: operation.id,
      kerf: effective.kerfOffsetMm !== 0,
      leads: laserLeadSpecFor(effective) !== null,
    };
    collectOpenLines(collected, settings, path, object);
  }
}

function collectOpenLines(
  collected: Collected,
  settings: Omit<Source, keyof JoinableCurve>,
  path: ColoredPath,
  object: SceneObject,
): void {
  const signature = `${settings.operationId}\u0000${settings.kerf}\u0000${settings.leads}`;
  for (const polyline of compilationPolylines(path, object.transform)) {
    if (polyline.closed || polyline.points.length < 2) continue;
    const points = polyline.points.map((point) => applyTransform(point, object.transform));
    const curve = polylineToCurveSubpath({ points, closed: false });
    collected.sources.push({ ...settings, curve, signature });
  }
}

function operationLines(collected: Collected, operation: Layer): OperationLines {
  const known = collected.operations.get(operation.id);
  if (known !== undefined) return known;
  const created = {
    name: operation.name,
    kerf: false,
    leads: false,
    outlines: 0,
    holdsShapes: false,
  };
  collected.operations.set(operation.id, created);
  return created;
}

function subpaths(path: ColoredPath): ReadonlyArray<{ readonly closed: boolean }> {
  return path.curves ?? path.polylines;
}

function closedStarts(path: ColoredPath, object: SceneObject): Vec2[] {
  const starts = (path.curves ?? []).flatMap((curve) => (curve.closed ? [curve.start] : []));
  const fallback =
    path.curves === undefined
      ? path.polylines.flatMap((polyline) =>
          polyline.closed && polyline.points[0] !== undefined ? [polyline.points[0]] : [],
        )
      : [];
  return [...starts, ...fallback].map((point) => applyTransform(point, object.transform));
}

function outlineIssue(operation: OperationLines): PreflightIssue | null {
  if (operation.outlines === 0) return null;
  const effects = [
    ...(operation.kerf ? ['no kerf offset'] : []),
    ...(operation.leads ? ['no lead-in or lead-out'] : []),
    ...(operation.holdsShapes ? ['the shapes inside are not cut first'] : []),
  ];
  if (effects.length === 0) return null;
  const one = operation.outlines === 1;
  return {
    code: 'line-open-outline',
    message:
      `Layer "${operation.name}": ${operation.outlines} outline${one ? ' is' : 's are'} drawn as ` +
      `open paths whose ends meet, so ${one ? 'it is' : 'they are'} cut as open lines: ` +
      `${listed(effects)}. Select ${one ? 'it' : 'them'} and use Tools > Join paths ` +
      `(gap up to ${OPEN_OUTLINE_GAP_MM} mm) to close ${one ? 'it' : 'them'}.`,
  };
}

function listed(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}
