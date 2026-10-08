import type { ColoredPath, ImportedSvg } from '../scene/scene-object';
import { polylineToCurveSubpath } from '../scene/curve-path';
import { subpathGeometryKey } from '../scene/subpath-nesting';
import { sameRecipeValue } from '../material-library/process-recipe';
import { solveConstrainedSketch } from './solve-constrained-sketch';
import { sketchPathGeometry, sketchPathKeys } from './sketch-path-geometry';

export type RetainedSketchPaths = {
  readonly settings: ReadonlyMap<string, ColoredPath>;
  readonly currentKeys: readonly string[];
};
type RetainedSketchPathsResult =
  | { readonly kind: 'ok'; readonly value: RetainedSketchPaths }
  | { readonly kind: 'invalid'; readonly reason: string };

/** Recover current path identities from old generated geometry, never the retained array order. */
export function retainedSketchPaths(previous: ImportedSvg | undefined): RetainedSketchPathsResult {
  if (previous?.constrainedSketch === undefined)
    return { kind: 'ok', value: { settings: new Map(), currentKeys: [] } };
  const original = solveConstrainedSketch(previous.constrainedSketch);
  if (original.kind !== 'solved' || original.status === 'over-constrained')
    return ambiguousBindings();
  const geometry = sketchPathGeometry(original.sketch, '');
  const keys = sketchPathKeys(original.sketch);
  if (previous.paths.length !== geometry.length) return ambiguousBindings();
  const candidates = generatedPathCandidates(geometry, keys);
  if (candidates === null) return ambiguousBindings();
  const settings = new Map<string, ColoredPath>();
  const currentKeys: string[] = [];
  for (const current of previous.paths) {
    const matches = (candidates.get(subpathGeometryKey(current)) ?? []).filter(({ path }) =>
      sameSketchPathGeometry(path, current),
    );
    const match = matches.length === 1 ? matches[0] : undefined;
    if (match === undefined || settings.has(match.key)) return ambiguousBindings();
    settings.set(match.key, current);
    currentKeys.push(match.key);
  }
  return { kind: 'ok', value: { settings, currentKeys } };
}
type SketchPathCandidate = { readonly path: ColoredPath; readonly key: string };
function generatedPathCandidates(
  geometry: readonly ColoredPath[],
  keys: readonly string[],
): ReadonlyMap<string, readonly SketchPathCandidate[]> | null {
  const candidates = new Map<string, SketchPathCandidate[]>();
  for (const [index, path] of geometry.entries()) {
    const key = keys[index];
    if (key === undefined) return null;
    const stamp = subpathGeometryKey(path);
    const entries = candidates.get(stamp) ?? [];
    entries.push({ path, key });
    candidates.set(stamp, entries);
  }
  return candidates;
}
function ambiguousBindings(): RetainedSketchPathsResult {
  return {
    kind: 'invalid',
    reason:
      "Cannot safely recover the sketch's machining bindings. Undo manual geometry edits or bake this sketch before regenerating.",
  };
}
function sameSketchPathGeometry(generated: ColoredPath, current: ColoredPath): boolean {
  return (
    sameRecipeValue(
      generated.curves,
      current.curves ?? current.polylines.map(polylineToCurveSubpath),
    ) && sameRecipeValue(generated.polylines, current.polylines)
  );
}
