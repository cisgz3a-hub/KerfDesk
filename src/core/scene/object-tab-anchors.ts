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
