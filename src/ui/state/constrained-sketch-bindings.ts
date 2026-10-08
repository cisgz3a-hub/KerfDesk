import type { ImportedSvg, CncTabAnchor } from '../../core/scene/scene-object';
import type { Project } from '../../core/scene/project';
import { sketchPathKeys } from '../../core/sketch-constraints/materialize-constrained-sketch';

/** Named sketch entities own their anchors; a removed entity never transfers a tab to its neighbour. */
export function retainSketchTabBindings(
  before: ImportedSvg | null,
  after: ImportedSvg,
  currentPathKeys?: readonly string[],
): ImportedSvg {
  if (before?.constrainedSketch === undefined || after.constrainedSketch === undefined)
    return after;
  const oldKeys = currentPathKeys ?? sketchPathKeys(before.constrainedSketch),
    nextKeys = sketchPathKeys(after.constrainedSketch);
  return {
    ...after,
    ...(before.cncTabAnchors === undefined
      ? {}
      : { cncTabAnchors: remapAnchors(before.cncTabAnchors, oldKeys, nextKeys, after) }),
    ...(before.laserTabAnchors === undefined
      ? {}
      : { laserTabAnchors: remapAnchors(before.laserTabAnchors, oldKeys, nextKeys, after) }),
  };
}
function remapAnchors(
  anchors: readonly CncTabAnchor[],
  oldKeys: readonly string[],
  nextKeys: readonly string[],
  after: ImportedSvg,
): readonly CncTabAnchor[] {
  return anchors.flatMap((anchor) => {
    const key = oldKeys[anchor.pathIndex];
    const pathIndex = key === undefined ? -1 : nextKeys.indexOf(key);
    const path = after.paths[pathIndex];
    if (path?.color !== anchor.layerColor || path.polylines[anchor.polylineIndex]?.closed !== true)
      return [];
    return [{ ...anchor, pathIndex }];
  });
}

/** Keep template baselines separate from explicit current-path overrides during regeneration. */
export function retainSketchRecipeBindings(
  project: Project,
  before: ImportedSvg,
  after: ImportedSvg,
): Project['processRecipeApplications'] {
  if (before.constrainedSketch === undefined || after.constrainedSketch === undefined)
    return project.processRecipeApplications;
  const oldKeys = sketchPathKeys(before.constrainedSketch),
    nextKeys = sketchPathKeys(after.constrainedSketch);
  return project.processRecipeApplications?.map((application) => {
    const bindings = application.bindings.map((binding) => {
      if (binding.objectId !== before.id || binding.pathOperationIds === undefined) return binding;
      const previous = binding.pathOperationIds;
      return {
        ...binding,
        pathOperationIds: nextKeys.map(
          (key) => previous[oldKeys.indexOf(key)] ?? binding.operationIds,
        ),
      };
    });
    return bindings.every((binding, index) => binding === application.bindings[index])
      ? application
      : { ...application, bindings };
  });
}
