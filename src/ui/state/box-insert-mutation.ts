// box-insert-mutation — commit a generated box panel sheet into the scene
// (ADR-106, F-K1): one polyline ShapeObject per panel, all on one cut-layer
// color (auto-created on demand), every inserted panel selected, and ONE
// undo entry so Undo removes the whole sheet in a single step.

import type { BoxPanel } from '../../core/box';
import { addObject } from '../../core/scene';
import { createPolyline } from '../../core/shapes';
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

export function applyInsertBoxPanels(
  s: StateSlice,
  panels: ReadonlyArray<BoxPanel>,
): (MutationResult & { readonly additionalSelectedIds: ReadonlySet<string> }) | null {
  const first = panels[0];
  if (first === undefined) return null;
  const objects = panels.map((panel) =>
    createPolyline({
      id: crypto.randomUUID(),
      color: BOX_PANEL_COLOR,
      spec: { points: ringWithoutClosingPoint(panel), closed: true },
    }),
  );
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

// PolylineSpec points must not repeat the first vertex — materialization
// appends the closing point itself (core/shapes/polyline convention).
function ringWithoutClosingPoint(panel: BoxPanel): BoxPanel['outline']['points'] {
  const points = panel.outline.points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first !== undefined && last !== undefined && first.x === last.x && first.y === last.y) {
    return points.slice(0, -1);
  }
  return points;
}
