// Open outlines on Line operations (ADR-626 Amendment 8; rolling audit
// 2026-10-21, 03-P2-9).
//
// Kerf offset, laser leads and inside-first order work on closed shapes only,
// as in LightBurn. An outline drawn as open paths whose ends meet, such as a
// CAD plate of four LINEs import could not join or lines that stop a hair
// short of each other, is cut as open lines: the kerf offset and the leads
// skip it, and the shapes inside it are not cut before it. Fill
// (offset-fill-open-contour) and CNC say what they do with open contours
// (cnc-open-contours-omitted for closed-only cuts; an Outside or Inside
// profile closes near-closed outlines and names what it cuts on the line,
// cnc-profile-open-path-on-line, ADR-672); this says it for Line, and only
// where one of those settings would have applied. Advisory only (rule 7,
// ADR-565): the lines are still cut as drawn.
//
// An outline is what Join paths makes of them at OPEN_OUTLINE_GAP_MM: open
// paths of one operation whose ends each meet one other end, closing a loop.
// Or one left open wider than that (ADR-626 Amendment 10, meta audit v1
// M6-R1): open paths that run nearly all the way round, their free ends
// closer together than a tenth of their length (laser-lead-open-gaps.ts). The
// message then names the gap Join paths must bridge. Kerf compensation of the
// closed shapes inside an outline does not see it either: they are offset as
// if nothing held them, so a hole is cut oversize, and that is said too.

import { effectiveObjectPowerPercent, effectiveOperationForObject } from '../effective-output';
import { pointInPolygon } from '../geometry/point-in-polygon';
import type { JoinableCurve } from '../geometry/path-endpoint-join';
import { compilationPolylines } from '../job/compilation-polylines';
import { vectorPowerReachesController } from '../job/job-start-power';
import { openOutlines } from '../job/laser-lead-open-gaps';
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
import { appendAll } from '../util';

/** Per operation, the outlines that miss a setting and which settings. */
type OperationLines = {
  readonly name: string;
  kerf: boolean;
  leads: boolean;
  outlines: number;
  holdsShapes: boolean;
  holdsKerfShapes: boolean;
  /** The widest gap an outline is left open by; 0 when every one's ends meet. */
  gapMm: number;
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
  /** One point of every closed Line contour cut with a kerf offset. */
  readonly kerfProbes: Vec2[];
};

type Holds = { readonly shapes: boolean; readonly kerfShapes: boolean };

export function lineOpenOutlineIssues(project: Project): ReadonlyArray<PreflightIssue> {
  const collected = collectLines(project);
  if (collected.sources.length === 0) return [];
  const { insideFirst, travelPolicy } = project.optimization;
  const ordersInsideFirst = insideFirst && travelPolicy !== 'source-order';
  for (const outline of openOutlines(collected.sources, OPEN_OUTLINE_GAP_MM)) {
    const source = collected.sources[outline.index];
    const operation =
      source === undefined ? undefined : collected.operations.get(source.operationId);
    if (source === undefined || operation === undefined) continue;
    const inside = (probe: Vec2) => pointInPolygon(probe, outline.points);
    const holds = {
      shapes: ordersInsideFirst && collected.probes.some(inside),
      kerfShapes: collected.kerfProbes.some(inside),
    };
    tallyOutline(operation, source, holds, outline.gapMm);
  }
  return [...collected.operations.values()].flatMap((operation) => {
    const issue = outlineIssue(operation);
    return issue === null ? [] : [issue];
  });
}

// An outline counts only when one of its own settings, or a shape inside it,
// needs it closed.
function tallyOutline(
  operation: OperationLines,
  source: Source,
  holds: Holds,
  gapMm: number,
): void {
  if (!source.kerf && !source.leads && !holds.shapes && !holds.kerfShapes) return;
  operation.outlines += 1;
  operation.kerf ||= source.kerf;
  operation.leads ||= source.leads;
  operation.holdsShapes ||= holds.shapes;
  operation.holdsKerfShapes ||= holds.kerfShapes;
  operation.gapMm = Math.max(operation.gapMm, gapMm);
}

function collectLines(project: Project): Collected {
  const collected: Collected = { sources: [], operations: new Map(), probes: [], kerfProbes: [] };
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
  const kerf = effective.kerfOffsetMm !== 0;
  for (const path of object.paths) {
    if (!pathUsesOperation(object, path, operation)) continue;
    const starts = closedStarts(path, object);
    appendAll(collected.probes, starts);
    if (kerf) appendAll(collected.kerfProbes, starts);
    if (!subpaths(path).some((subpath) => !subpath.closed)) continue;
    operationLines(collected, operation);
    const settings = {
      operationId: operation.id,
      kerf,
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
    holdsKerfShapes: false,
    gapMm: 0,
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
  const one = operation.outlines === 1;
  const effects = outlineEffects(operation, one);
  if (effects.length === 0) return null;
  const gapMm = Math.max(OPEN_OUTLINE_GAP_MM, roundedUp(operation.gapMm));
  const ends = operation.gapMm === 0 ? 'meet' : `stop up to ${roundedUp(operation.gapMm)} mm apart`;
  return {
    code: 'line-open-outline',
    message:
      `Layer "${operation.name}": ${operation.outlines} outline${one ? ' is' : 's are'} drawn as ` +
      `open paths whose ends ${ends}, so ${one ? 'it is' : 'they are'} cut as open lines: ` +
      `${listed(effects)}. Select ${one ? 'it' : 'them'} and use Tools > Join paths ` +
      `(gap up to ${gapMm} mm) to close ${one ? 'it' : 'them'}.`,
  };
}

function outlineEffects(operation: OperationLines, one: boolean): string[] {
  return [
    ...(operation.kerf ? ['no kerf offset'] : []),
    ...(operation.leads ? ['no lead-in or lead-out'] : []),
    ...(operation.holdsKerfShapes
      ? [`the shapes inside are kerf-offset as if ${one ? 'it' : 'they'} did not hold them`]
      : []),
    ...(operation.holdsShapes ? ['the shapes inside are not cut first'] : []),
  ];
}

/** Up to the next 0.1 mm, so Join paths at that gap bridges it. */
function roundedUp(mm: number): number {
  return Math.ceil(mm * 10 - 1e-9) / 10;
}

function listed(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}
