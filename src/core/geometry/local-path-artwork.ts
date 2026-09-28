// Convert text or a drawn shape to plain path artwork without moving anything:
// the paths, their exact curves and the placement transform stay as they are,
// only the settings the object would rebuild its paths from are dropped. Trim
// Shapes (LightBurn gap LBG-T04) uses it so a trimmed rectangle keeps its
// rotation and an ellipse keeps its exact arcs.

import type { ColoredPath, ImportedSvg, ShapeObject, TextObject } from '../scene';

export function localPathArtwork(object: TextObject | ShapeObject): ImportedSvg {
  return {
    ...(object.operationIds === undefined ? {} : { operationIds: object.operationIds }),
    ...(object.powerScale === undefined ? {} : { powerScale: object.powerScale }),
    ...(object.operationOverride === undefined
      ? {}
      : { operationOverride: object.operationOverride }),
    ...(object.locked === undefined ? {} : { locked: object.locked }),
    ...(object.cncTabAnchors === undefined ? {} : { cncTabAnchors: object.cncTabAnchors }),
    ...(object.laserTabAnchors === undefined ? {} : { laserTabAnchors: object.laserTabAnchors }),
    kind: 'imported-svg',
    id: object.id,
    source: `${object.kind === 'text' ? `Text: ${object.content}` : `Shape: ${object.spec.kind}`} (paths)`,
    bounds: object.bounds,
    transform: object.transform,
    paths: object.kind === 'text' ? object.paths.map(textPath) : object.paths,
  };
}

// Text fills non-zero; a converted outline keeps that, as Convert to Path does.
function textPath(path: ColoredPath): ColoredPath {
  return path.fillRule === undefined ? { ...path, fillRule: 'nonzero' } : path;
}
