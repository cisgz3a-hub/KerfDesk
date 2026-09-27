// box-insert-mutation — commit a generated box panel sheet into the scene
// (ADR-106/116, F-K1): one imported-svg vector object per panel (the baked
// generated-geometry carrier — dogbone/weld precedent) so cutout rings read
// as real holes under even-odd fill and the source field carries the panel
// name. All panels land on one cut-layer color (auto-created on demand),
// every inserted panel is selected, and ONE undo entry removes the sheet.
//
// On a CNC machine the parts come out cut through (ADR-106 Amd 2): both
// operations cut the full material thickness. Outlines profile outside with
// the default holding tabs; slots go to their own pocket operation, which
// clears every slot completely, so there is no loose piece for a tab to hold
// and nothing is left bridging the slot. Clearing runs before any profile can
// free a part, so the slots are cut while the panel is still held.

import {
  addObject,
  addLayer,
  bindSceneObjectToOperations,
  createArtworkOperation,
  IDENTITY_TRANSFORM,
  DEFAULT_CNC_LAYER_SETTINGS,
  type Bounds,
  type CncCutType,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { pushUndo, type MutationResult, type StateSlice } from './scene-mutations';

// The default drawn-vector cut color (draw-tool parity): panels join the
// black line layer, auto-created when the scene has none. Kept local — the
// state module must not import the workspace tool that declares it.
// eslint-disable-next-line no-restricted-syntax -- scene DATA: the panels' layer color key (what the laser cuts by), not chrome (ADR-047).
const BOX_PANEL_COLOR = '#000000';

// Never routed through importSvgObject, so Phase C re-import
// replace-by-source semantics cannot trigger on generated panels.
const BOX_PANEL_SOURCE_PREFIX = 'Box panel: ';
const PANEL_OPERATION_NAME = 'Box panels';
const SLOT_OPERATION_NAME = 'Box slots';

/** Any generated part with a name and rings (box panels, fit coupons). */
export type InsertablePart = {
  readonly name: string;
  readonly outline: Polyline;
  readonly cutouts: ReadonlyArray<Polyline>;
};

/** The stock the parts were drawn for; CNC operations cut its full thickness. */
export type InsertableSheet = { readonly thicknessMm: number };

/** The store action: insert one generated sheet as a single undo step. */
export type InsertBoxPanels = (
  panels: ReadonlyArray<InsertablePart>,
  sheet: InsertableSheet,
) => void;

export function applyInsertBoxPanels(
  s: StateSlice,
  panels: ReadonlyArray<InsertablePart>,
  sheet: InsertableSheet,
): (MutationResult & { readonly additionalSelectedIds: ReadonlySet<string> }) | null {
  const sourceObjects = panels.map(panelObject);
  const firstSource = sourceObjects[0];
  if (firstSource === undefined) return null;
  const inserted =
    s.project.machine?.kind === 'cnc'
      ? cncOperations(s.project.scene, firstSource, sourceObjects, panels, sheet)
      : laserOperation(s.project.scene, firstSource, sourceObjects);
  let scene = s.project.scene;
  for (const operation of inserted.operations) scene = addLayer(scene, operation);
  const objects = inserted.objects;
  for (const object of objects) scene = addObject(scene, object);
  const [head, ...rest] = objects;
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

type InsertedSheet = {
  readonly operations: ReadonlyArray<Layer>;
  readonly objects: ReadonlyArray<SceneObject>;
};

function laserOperation(
  scene: Scene,
  firstSource: ImportedSvg,
  sourceObjects: ReadonlyArray<ImportedSvg>,
): InsertedSheet {
  const { operation } = createArtworkOperation(scene, firstSource, { name: PANEL_OPERATION_NAME });
  return {
    operations: [operation],
    objects: sourceObjects.map((object) => bindSceneObjectToOperations(object, [operation.id])),
  };
}

// Outlines profile outside (the compiler grows them by the bit radius, so the
// panel keeps its drawn size); slots, when there are any, pocket in their own
// operation. Each panel's outline and slot rings become separate paths bound
// to their operation.
function cncOperations(
  scene: Scene,
  firstSource: ImportedSvg,
  sourceObjects: ReadonlyArray<ImportedSvg>,
  panels: ReadonlyArray<InsertablePart>,
  sheet: InsertableSheet,
): InsertedSheet {
  const panelOperation = withCncCut(
    createArtworkOperation(scene, firstSource, { name: PANEL_OPERATION_NAME }).operation,
    'profile-outside',
    sheet.thicknessMm,
  );
  if (!panels.some((panel) => panel.cutouts.length > 0)) {
    return {
      operations: [panelOperation],
      objects: sourceObjects.map((object) =>
        bindSceneObjectToOperations(object, [panelOperation.id]),
      ),
    };
  }
  const slotOperation = withCncCut(
    createArtworkOperation({ ...scene, layers: [...scene.layers, panelOperation] }, firstSource, {
      name: SLOT_OPERATION_NAME,
    }).operation,
    'pocket',
    sheet.thicknessMm,
  );
  return {
    operations: [panelOperation, slotOperation],
    objects: sourceObjects.map((object, index) =>
      splitSlotRings(object, panels[index], panelOperation, slotOperation),
    ),
  };
}

function withCncCut(operation: Layer, cutType: CncCutType, depthMm: number): Layer {
  return {
    ...operation,
    cnc: { ...(operation.cnc ?? DEFAULT_CNC_LAYER_SETTINGS), cutType, depthMm },
  };
}

function splitSlotRings(
  object: ImportedSvg,
  panel: InsertablePart | undefined,
  panelOperation: Layer,
  slotOperation: Layer,
): ImportedSvg {
  if (panel === undefined) return object;
  const outlinePath = {
    color: BOX_PANEL_COLOR,
    polylines: [panel.outline],
    operationIds: [panelOperation.id],
  };
  const slotPath = {
    color: slotOperation.color,
    polylines: panel.cutouts,
    operationIds: [slotOperation.id],
  };
  const { operationIds: _operationIds, ...unbound } = object;
  return { ...unbound, paths: panel.cutouts.length > 0 ? [outlinePath, slotPath] : [outlinePath] };
}

function panelObject(panel: InsertablePart): ImportedSvg {
  const polylines = [panel.outline, ...panel.cutouts];
  return {
    kind: 'imported-svg',
    id: crypto.randomUUID(),
    source: `${BOX_PANEL_SOURCE_PREFIX}${panel.name}`,
    bounds: ringsBounds(polylines),
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: BOX_PANEL_COLOR, polylines }],
  };
}

function ringsBounds(polylines: ReadonlyArray<Polyline>): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const polyline of polylines) {
    for (const point of polyline.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}
