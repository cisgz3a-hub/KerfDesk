// design-apply-mutation — commit a Design Studio sketch into the scene
// (ADR-268, Phase N DS-5, flow F-DS8).
//
// The ONE place the Studio writes to the project. Mirrors applyInsertBoxPanels:
// every designed entity becomes a scene object, they all share one auto-created
// cut operation, every inserted object is selected, and ONE undo entry removes
// the whole apply. Compile, preview, emit and save are untouched — a designed
// part is indistinguishable downstream from imported artwork.

import { designEntityToSceneObject, type Sketch } from '../../core/design';
import {
  addLayer,
  addObject,
  bindSceneObjectToOperations,
  createArtworkOperation,
  type SceneObject,
} from '../../core/scene';
import { pushUndo, type MutationResult, type StateSlice } from './scene-mutations';

// The default drawn-vector cut colour (draw-tool / box-panel parity): designed
// parts join the black line layer, auto-created when the scene has none.
// eslint-disable-next-line no-restricted-syntax -- scene DATA: the layer colour key the laser cuts by, not chrome (ADR-047).
const DESIGN_CUT_COLOR = '#000000';

const DESIGN_OPERATION_NAME = 'Design';

/**
 * Inserts every output entity of `sketch` as a scene object.
 *
 * Returns null when the sketch contributes nothing — empty, or entirely
 * construction geometry. Null means "nothing applied", never an error, and the
 * caller leaves the project untouched (rule 7: inform, never refuse).
 */
export function applyDesignSketch(
  s: StateSlice,
  sketch: Sketch,
  ids: ReadonlyArray<string>,
): (MutationResult & { readonly additionalSelectedIds: ReadonlySet<string> }) | null {
  const objects = buildObjects(sketch, ids);
  const first = objects[0];
  if (first === undefined) return null;
  const created = createArtworkOperation(s.project.scene, first, { name: DESIGN_OPERATION_NAME });
  const bound = objects.map((object) =>
    bindSceneObjectToOperations(object, [created.operation.id]),
  );
  let scene = addLayer(s.project.scene, created.operation);
  for (const object of bound) scene = addObject(scene, object);
  const [head, ...rest] = bound;
  if (head === undefined) return null;
  return {
    project: { ...s.project, scene },
    selectedObjectId: head.id,
    additionalSelectedIds: new Set(rest.map((object) => object.id)),
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}

// Ids arrive from the caller because pure core may not generate identity. An id
// list shorter than the entity list simply stops early rather than minting a
// duplicate, which would silently drop an object at addObject.
function buildObjects(sketch: Sketch, ids: ReadonlyArray<string>): ReadonlyArray<SceneObject> {
  const objects: SceneObject[] = [];
  sketch.entities.forEach((entity, index) => {
    const id = ids[index];
    if (id === undefined) return;
    const object = designEntityToSceneObject(entity, id, DESIGN_CUT_COLOR);
    if (object !== null) objects.push(object);
  });
  return objects;
}
