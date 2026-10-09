import type { ReliefRailProfileSource, ReliefOpenRail } from '../scene/relief/relief-rail-profile';
import type { SceneObject, Transform } from '../scene/scene-object';
import { IDENTITY_TRANSFORM } from '../scene/scene-object';
import { applyTransform } from '../scene/transform';
import { inverseReliefPoint } from './relief-vector-boundary';
import { reliefRailProfileError } from './relief-rail-profile-validation';

export function openRailForRelief(
  object: SceneObject,
  root: Transform,
  component = IDENTITY_TRANSFORM,
): ReliefOpenRail {
  if (!('paths' in object)) throw new Error('A rail must be open vector artwork.');
  const polylines = object.paths.flatMap((path) => path.polylines);
  const line = polylines[0];
  if (polylines.length !== 1 || line === undefined || line.closed)
    throw new Error('A rail requires exactly one open vector path.');
  if (line.points.length < 2 || line.points.length > 32)
    throw new Error('Open rail requires 2–32 vector points.');
  return {
    linkedObjectId: object.id,
    linkComponentTransform: component,
    points: line.points.map((p) =>
      inverseReliefPoint(inverseReliefPoint(applyTransform(p, object.transform), root), component),
    ),
  };
}
export function refreshReliefRailLinks(
  source: ReliefRailProfileSource,
  objects: ReadonlyArray<SceneObject>,
  root: Transform,
  component: Transform,
  legacy = false,
): { readonly source: ReliefRailProfileSource; readonly changed: boolean } {
  const refresh = (rail: ReliefOpenRail): ReliefOpenRail => {
    if (rail.linkedObjectId === undefined) return rail;
    const object = objects.find((o) => o.id === rail.linkedObjectId);
    if (object === undefined)
      throw new Error(`Linked relief rail ${rail.linkedObjectId} is missing.`);
    const updated = openRailForRelief(object, root, rail.linkComponentTransform ?? component);
    return { ...rail, points: updated.points };
  };
  const updated: ReliefRailProfileSource = {
    ...source,
    rail: refresh(source.rail),
    ...(source.secondRail === undefined ? {} : { secondRail: refresh(source.secondRail) }),
  };
  const error = reliefRailProfileError(updated, legacy);
  if (error !== null) throw new Error(error);
  const changed = JSON.stringify(updated) !== JSON.stringify(source);
  return { source: changed ? updated : source, changed };
}
export function detachedRailProfile(source: ReliefRailProfileSource): ReliefRailProfileSource {
  const detach = (rail: ReliefOpenRail): ReliefOpenRail => ({
    points: rail.points,
    ...(rail.reversed === undefined ? {} : { reversed: rail.reversed }),
  });
  return {
    ...source,
    rail: detach(source.rail),
    ...(source.secondRail === undefined ? {} : { secondRail: detach(source.secondRail) }),
  };
}
