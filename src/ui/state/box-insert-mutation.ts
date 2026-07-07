// box-insert-mutation — commit a generated box panel sheet into the scene
// (ADR-106/116, F-K1): one imported-svg vector object per panel (the baked
// generated-geometry carrier — dogbone/weld precedent) so cutout rings read
// as real holes under even-odd fill and the source field carries the panel
// name. All panels land on one cut-layer color (auto-created on demand),
// every inserted panel is selected, and ONE undo entry removes the sheet.

import {
  addObject,
  IDENTITY_TRANSFORM,
  type Bounds,
  type ImportedSvg,
  type Polyline,
} from '../../core/scene';
import {
  ensureLayersForColors,
  pushUndo,
  type MutationResult,
  type StateSlice,
} from './scene-mutations';

// The default drawn-vector cut color (draw-tool parity): panels join the
// black line layer, auto-created when the scene has none. Kept local — the
// state module must not import the workspace tool that declares it.
// eslint-disable-next-line no-restricted-syntax -- scene DATA: the panels' layer color key (what the laser cuts by), not chrome (ADR-047).
const BOX_PANEL_COLOR = '#000000';

// Never routed through importSvgObject, so Phase C re-import
// replace-by-source semantics cannot trigger on generated panels.
const BOX_PANEL_SOURCE_PREFIX = 'Box panel: ';

/** Any generated part with a name and rings (box panels, fit coupons). */
export type InsertablePart = {
  readonly name: string;
  readonly outline: Polyline;
  readonly cutouts: ReadonlyArray<Polyline>;
};

export function applyInsertBoxPanels(
  s: StateSlice,
  panels: ReadonlyArray<InsertablePart>,
): (MutationResult & { readonly additionalSelectedIds: ReadonlySet<string> }) | null {
  const objects = panels.map(panelObject);
  let scene = s.project.scene;
  for (const object of objects) scene = addObject(scene, object);
  scene = ensureLayersForColors(scene, [{ color: BOX_PANEL_COLOR }]);
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
