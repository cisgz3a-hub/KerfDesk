// Registering an outline board that is already on the canvas (ADR-654). The
// operator lays artwork out on the drawn outline before the head measures where
// the board really sits. Registration keeps the outline where it is drawn, gives
// it the shape and turn the head measured, and turns the artwork on it about the
// same point, so every design keeps its place on the physical board.

import {
  applyTransform,
  findRegistrationBoxes,
  pointInPolygon,
  transformedBBox,
  type BoardShape,
  type SceneObject,
  type ShapeObject,
  type Vec2,
} from '../../core/scene';
import { buildSelectionRotateByEdit } from '../../core/scene/selection-rotate';
import { createRegistrationOutline } from '../../core/shapes';
import type { JobPlacementSettings } from '../job-placement';
import { pushUndo } from './scene-mutations';
import { captureSetupHistoryContext } from './setup-history-context';
import type { AppState } from './store';

export type OutlineBoardShape = Extract<BoardShape, { readonly kind: 'outline' }>;

/** Null when no drawn outline board is on the canvas to register. */
export function registerCapturedOutlineMutation(
  s: AppState,
  shape: OutlineBoardShape,
  rotationDeg: number,
  placement: JobPlacementSettings,
): Partial<AppState> | null {
  const scene = s.project.scene;
  const boards = findRegistrationBoxes(scene);
  const existing = boards.find((box) => box.provenance === 'captured-board');
  if (existing === undefined || existing.spec.kind !== 'polyline') return null;
  // One Undo step turns the board, its artwork and Start From back together
  // (item 5; ADR-654 Amendment 2).
  captureSetupHistoryContext(s.project, s);
  const drawn = existing.spec.points.map((point) => applyTransform(point, existing.transform));
  const pivot = vertexCentre(drawn);
  const centre = vertexCentre(shape.pointsMm);
  const outline: ShapeObject = {
    ...existing,
    ...createRegistrationOutline({
      id: existing.id,
      pointsMm: shape.pointsMm,
      x: pivot.x - centre.x,
      y: pivot.y - centre.y,
    }),
    locked: true,
    provenance: 'captured-board',
  };
  const turned = turnArtworkOnBoard(scene.objects, boards, drawn, pivot, rotationDeg);
  const objects = scene.objects.map((object) =>
    object.id === existing.id ? outline : (turned.get(object.id) ?? object),
  );
  const project = { ...s.project, scene: { ...scene, objects } };
  delete project.registrationArtworkOutputSnapshot;
  return {
    project,
    jobPlacement: placement,
    registrationArtworkOutputSnapshot: null,
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}

// Unlocked artwork whose centre lies on the drawn board turns with the board.
// Locked artwork stays where the operator pinned it.
function turnArtworkOnBoard(
  objects: ReadonlyArray<SceneObject>,
  boards: ReadonlyArray<ShapeObject>,
  drawn: ReadonlyArray<Vec2>,
  pivot: Vec2,
  rotationDeg: number,
): ReadonlyMap<string, SceneObject> {
  const boardIds = new Set(boards.map((board) => board.id));
  const onBoard = objects.filter(
    (object) =>
      !boardIds.has(object.id) &&
      object.locked !== true &&
      pointInPolygon(boundsCentre(object), drawn),
  );
  const result = buildSelectionRotateByEdit(onBoard, rotationDeg, pivot);
  const turned = new Map<string, SceneObject>();
  if (result.kind === 'error') return turned;
  const byId = new Map(onBoard.map((object) => [object.id, object]));
  for (const { id, transform } of result.transforms) {
    const object = byId.get(id);
    // Spreading the union widens it; the kind discriminant is unchanged.
    if (object !== undefined) turned.set(id, { ...object, transform } as SceneObject);
  }
  return turned;
}

function boundsCentre(object: SceneObject): Vec2 {
  const box = transformedBBox(object);
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

function vertexCentre(points: ReadonlyArray<Vec2>): Vec2 {
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / points.length, y: sum.y / points.length };
}
