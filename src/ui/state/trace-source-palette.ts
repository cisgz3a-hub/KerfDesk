// Frees the palette color held by a retained trace-source backing.
//
// A trace-source is a visual backing only: compile-job-raster, frame-bounds,
// and preflight all skip `role: 'trace-source'`, so it emits no G-code. It must
// therefore not go on holding a palette color that the artwork actually being
// cut should have. Without this, tracing a freshly imported photo leaves the
// invisible backing on OPERATION_PALETTE[0] (black) and pushes the visible
// trace onto the runner-up (blue) — the artwork the operator cuts ends up
// outranked by a reference object they are expected to delete.
//
// Moving the backing to the reserved image grey hands black back to the
// first-unused-wins allocator, so the operation created for the trace takes it.

import {
  DEFAULT_RASTER_LAYER_COLOR,
  nextOperationColor,
  operationIdsForObject,
  type Scene,
  type SceneObject,
  sceneObjectUsesOperation,
} from '../../core/scene';

// OPERATION_PALETTE[0] — what the allocator hands out when nothing is taken.
// Derived rather than restated so it cannot drift from the palette itself.
// Withheld from the backing so the artwork being cut receives it.
const ARTWORK_FIRST_COLOR = nextOperationColor([]);

export function releaseTraceSourcePalette(scene: Scene, source: SceneObject): Scene {
  // Only recolor when the backing is bound by an EXPLICIT operation id. A legacy
  // color-bound source (schema-v2: no operationIds, resolved by color match)
  // would be re-pointed at whatever now holds its old color if we recolored the
  // layer alone — core's recolorLayer rewrites the object's color too, which we
  // deliberately don't. The real import flow always binds explicitly
  // (createArtworkOperation → bindSceneObjectToOperations), so this only skips
  // hand-built or pre-migration scenes, leaving their behavior unchanged rather
  // than corrupting the binding.
  if (!hasExplicitBinding(source)) return scene;
  return operationIdsForObject(source, scene.layers).reduce(
    (acc, operationId) => releaseOperation(acc, source, operationId),
    scene,
  );
}

function hasExplicitBinding(object: SceneObject): boolean {
  if (object.operationIds !== undefined) return true;
  return 'paths' in object && object.paths.some((path) => path.operationIds !== undefined);
}

function releaseOperation(scene: Scene, source: SceneObject, operationId: string): Scene {
  const operation = scene.layers.find((layer) => layer.id === operationId);
  if (operation === undefined) return scene;
  // Shared with artwork that still outputs — recoloring would drag that
  // artwork's swatch along with the backing, so leave the operation alone.
  const isShared = scene.objects.some(
    (object) => object.id !== source.id && sceneObjectUsesOperation(object, operation),
  );
  if (isShared) return scene;
  const color = backingColor(scene, operationId);
  if (color === operation.color) return scene;
  // Recolor the layer only. Safe because releaseTraceSourcePalette gated on an
  // explicit binding, so core's recolorLayer would leave the source object
  // untouched here too — the object resolves by id, not color. (recolorLayer
  // itself isn't reachable: it is off the core/scene barrel, which sits at its
  // no-growth ratchet baseline in scripts/index-export-baseline.json.)
  return {
    ...scene,
    layers: scene.layers.map((layer) => (layer.id === operationId ? { ...layer, color } : layer)),
  };
}

function backingColor(scene: Scene, operationId: string): string {
  const others = scene.layers.filter((layer) => layer.id !== operationId);
  if (!others.some((layer) => layer.color === DEFAULT_RASTER_LAYER_COLOR)) {
    return DEFAULT_RASTER_LAYER_COLOR;
  }
  // Grey is taken. Reserve the first palette color for the artwork so the
  // allocator hands the backing the next free one instead of returning black.
  return nextOperationColor([...others, { color: ARTWORK_FIRST_COLOR }]);
}
