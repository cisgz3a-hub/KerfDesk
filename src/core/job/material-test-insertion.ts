// Adds a Material Test to an open design instead of replacing it (ADR-381).
// The test gets its own id prefix and unused operation colors, lands in free
// bed space near the machine origin, and is grouped so it moves, selects and
// burns ("Selected artwork only") as one piece. Nothing already in the project
// changes.

import {
  combinedBBox,
  transformedBBox,
  type Scene,
  type SceneGroup,
  type SceneObject,
} from '../scene';
import {
  DEFAULT_MATERIAL_TEST_ID_PREFIX,
  generateMaterialTestAxesGrid,
  type MaterialTestAxesGrid,
  type MaterialTestAxesGridOptions,
} from './material-test-axes-grid';
import { sceneColorsInUse } from './material-test-colors';
import {
  placeTestOnBed,
  type TestPlacement,
  type TestPlacementDevice,
} from './material-test-placement';

// The project validator's scene budgets (io/project PROJECT_SCENE_LIMITS).
const PROJECT_OPERATION_LIMIT = 256;
const PROJECT_OBJECT_LIMIT = 10_000;

export type MaterialTestInsertion =
  | {
      readonly kind: 'inserted';
      readonly scene: Scene;
      readonly grid: MaterialTestAxesGrid;
      readonly name: string;
      readonly objectIds: ReadonlyArray<string>;
      readonly placement: TestPlacement;
    }
  | { readonly kind: 'refused'; readonly reason: string };

export type MaterialTestInsertOptions = Omit<
  MaterialTestAxesGridOptions,
  'idPrefix' | 'reservedColors' | 'origin'
>;

export function insertMaterialTest(
  scene: Scene,
  device: TestPlacementDevice,
  options: MaterialTestInsertOptions,
): MaterialTestInsertion {
  const { prefix, ordinal } = nextMaterialTestPrefix(scene);
  const grid = generateMaterialTestAxesGrid({
    ...options,
    idPrefix: prefix,
    reservedColors: sceneColorsInUse(scene),
  });
  const refusal = budgetRefusal(scene, grid);
  if (refusal !== null) return { kind: 'refused', reason: refusal };
  const box = combinedBBox(grid.scene.objects) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const placement = placeTestOnBed(
    { width: box.maxX - box.minX, height: box.maxY - box.minY },
    scene.objects.map(transformedBBox),
    device,
  );
  const objects = grid.scene.objects.map((object) =>
    translated(object, placement.x - box.minX, placement.y - box.minY),
  );
  const name = ordinal === 1 ? 'Material test' : `Material test ${ordinal}`;
  const objectIds = objects.map((object) => object.id);
  const group: SceneGroup = { id: `${prefix}-group`, name, objectIds };
  return {
    kind: 'inserted',
    scene: {
      ...scene,
      objects: [...scene.objects, ...objects],
      layers: [...scene.layers, ...grid.scene.layers],
      groups: [...(scene.groups ?? []), group],
    },
    grid,
    name,
    objectIds,
    placement,
  };
}

/** The first `material-test[-n]` prefix no object, operation or group uses. */
export function nextMaterialTestPrefix(scene: Scene): {
  readonly prefix: string;
  readonly ordinal: number;
} {
  const ids = [
    ...scene.objects.map((object) => object.id),
    ...scene.layers.map((layer) => layer.id),
    ...(scene.groups ?? []).map((group) => group.id),
  ];
  for (let ordinal = 1; ; ordinal += 1) {
    const prefix =
      ordinal === 1
        ? DEFAULT_MATERIAL_TEST_ID_PREFIX
        : `${DEFAULT_MATERIAL_TEST_ID_PREFIX}-${ordinal}`;
    if (!ids.some((id) => id === prefix || id.startsWith(`${prefix}-`))) return { prefix, ordinal };
  }
}

function budgetRefusal(scene: Scene, grid: MaterialTestAxesGrid): string | null {
  const operations = scene.layers.length + grid.scene.layers.length;
  if (operations > PROJECT_OPERATION_LIMIT) {
    return (
      `This test adds ${grid.scene.layers.length} operations to the ${scene.layers.length} ` +
      `already in the project, over the ${PROJECT_OPERATION_LIMIT} a project can hold. ` +
      'Open it as a new project instead.'
    );
  }
  if (scene.objects.length + grid.scene.objects.length > PROJECT_OBJECT_LIMIT) {
    return (
      `This test adds ${grid.scene.objects.length} objects, over the ${PROJECT_OBJECT_LIMIT} ` +
      'a project can hold. Open it as a new project instead.'
    );
  }
  return null;
}

function translated(object: SceneObject, dx: number, dy: number): SceneObject {
  return {
    ...object,
    transform: { ...object.transform, x: object.transform.x + dx, y: object.transform.y + dy },
  };
}
