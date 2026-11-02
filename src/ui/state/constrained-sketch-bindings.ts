import type { ImportedSvg, CncTabAnchor } from '../../core/scene/scene-object';
import type { Project } from '../../core/scene/project';
import { placedTabCount } from '../../core/scene/object-tab-anchors';
import { withTabsFollowingRebuiltContours } from '../../core/geometry/rebuilt-contour-tabs';
import { sketchPathKeys } from '../../core/sketch-constraints/materialize-constrained-sketch';

/** A rebuilt sketch, and what the rebuild did to its tabs placed by hand. */
export type RetainedSketchTabs = {
  readonly object: ImportedSvg;
  /** Tabs with no matching edge on the new outline, moved to the nearest point of it. */
  readonly movedTabs: number;
  /** Tabs on entities the new sketch removed. */
  readonly removedTabs: number;
};

/** Named sketch entities own their anchors; a removed entity never transfers a tab to its
 *  neighbour, and a kept one carries them to the same place on its new outline. */
export function retainSketchTabBindings(
  before: ImportedSvg | null,
  after: ImportedSvg,
  currentPathKeys?: readonly string[],
): RetainedSketchTabs {
  if (before?.constrainedSketch === undefined || after.constrainedSketch === undefined)
    return { object: after, movedTabs: 0, removedTabs: 0 };
  const oldKeys = currentPathKeys ?? sketchPathKeys(before.constrainedSketch),
    nextKeys = sketchPathKeys(after.constrainedSketch);
  const remapped = {
    ...after,
    ...(before.cncTabAnchors === undefined
      ? {}
      : { cncTabAnchors: remapAnchors(before.cncTabAnchors, oldKeys, nextKeys, after) }),
    ...(before.laserTabAnchors === undefined
      ? {}
      : { laserTabAnchors: remapAnchors(before.laserTabAnchors, oldKeys, nextKeys, after) }),
  };
  const followed = withTabsFollowingRebuiltContours(before, remapped, (pathIndex) => {
    const previous = oldKeys.indexOf(nextKeys[pathIndex] ?? '');
    return previous < 0 ? undefined : previous;
  });
  return {
    object: followed.object,
    movedTabs: followed.moved,
    removedTabs: placedTabCount(before) - placedTabCount(followed.object),
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
