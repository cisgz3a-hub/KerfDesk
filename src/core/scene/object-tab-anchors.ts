import type { SceneObject } from './scene-object';

/** The CNC and laser (ADR-494) tab anchors of an object, for an edit that
 * rebuilds the object and keeps its placed tabs. */
export function objectTabAnchorFields(
  object: SceneObject,
): Pick<SceneObject, 'cncTabAnchors' | 'laserTabAnchors'> {
  return {
    ...(object.cncTabAnchors === undefined ? {} : { cncTabAnchors: object.cncTabAnchors }),
    ...(object.laserTabAnchors === undefined ? {} : { laserTabAnchors: object.laserTabAnchors }),
  };
}

/** How many tabs are placed by hand on an object, laser and CNC counted apart. */
export function placedTabCount(object: SceneObject): number {
  return (object.cncTabAnchors?.length ?? 0) + (object.laserTabAnchors?.length ?? 0);
}
