// Full hit stack for explicit select-under interactions. Normal click keeps
// using hitTest's early-exit path; Alt+click pays the full scan only when the
// operator asks to cycle through overlapping artwork.

import type { Layer } from './layer';
import type { Scene } from './scene';
import type { Vec2 } from './scene-object';
import { fillPoolParityAt, hitTestObject, OUTLINES_ONLY } from './hit-test';
import { sceneLayerVisibilityLookup, sceneObjectHasVisibleLayerFromMap } from './visibility';

type InteriorCandidate = {
  readonly id: string;
  readonly area: number;
  readonly zRank: number;
};

export function hitTestCandidates(
  scene: Scene,
  point: Vec2,
  options: { readonly wireframe?: boolean; readonly strokeToleranceMm?: number } = {},
): ReadonlyArray<string> {
  const layerByColor = sceneLayerVisibilityLookup(scene.layers);
  const pools =
    options.wireframe === true
      ? OUTLINES_ONLY
      : fillPoolParityAt(scene, layerByColor, point, options.strokeToleranceMm);
  const primary: string[] = [];
  const interiors: InteriorCandidate[] = [];
  let zRank = 0;
  for (let index = scene.objects.length - 1; index >= 0; index -= 1) {
    const object = scene.objects[index];
    if (object === undefined || !isSelectable(object, layerByColor)) continue;
    const hit = hitTestObject(layerByColor, object, point, pools, options.strokeToleranceMm);
    if (hit.kind === 'primary') primary.push(object.id);
    if (hit.kind === 'line-interior') interiors.push({ id: object.id, area: hit.area, zRank });
    zRank += 1;
  }
  const orderedInteriors = [...interiors]
    .sort((left, right) => left.area - right.area || left.zRank - right.zRank)
    .map((candidate) => candidate.id);
  return [...primary, ...orderedInteriors];
}

function isSelectable(
  object: Scene['objects'][number],
  layerByColor: ReadonlyMap<string, Layer>,
): boolean {
  return object.locked !== true && sceneObjectHasVisibleLayerFromMap(object, layerByColor);
}
