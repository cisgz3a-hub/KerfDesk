// Where each scene object stands this frame, and what the Fill pools are
// planned from (ADR-683 Amendment 3). Objects on the canvas resolve their
// display as before. The pools are planned from every visible vector, off the
// canvas too, with the display it last resolved under the same operations and
// view mode, so a pan that moves objects across the canvas edge brings the
// same inputs and plans nothing. An object off the canvas paints nothing: its
// contours lie outside it, so they cannot change the parity of a pixel on it.

import { sceneLayerVisibility, type Layer, type SceneObject } from '../../core/scene';
import type { DisplayPolylineCache } from './display-polylines';
import type { ResolvedVector } from './fill-pools';
import {
  isVectorSceneObject,
  resolveObjectDisplay,
  type ArtworkPalette,
  type ObjectDisplay,
  type ObjectDisplayMode,
  type VectorSceneObject,
} from './object-display';
import { objectIntersectsCanvas } from './object-viewport';
import type { ViewTransform } from './view-transform';

export type PlacedObject = {
  readonly isVisible: boolean;
  readonly onCanvas: boolean;
  /** The object's resolved vector when it is drawn on the canvas this frame. */
  readonly vector: ResolvedVector | undefined;
};

export type PlacedScene = {
  readonly placed: ReadonlyArray<PlacedObject>;
  /** Every visible vector, for planning the pools (on the canvas: `vector`). */
  readonly planned: ReadonlyArray<ResolvedVector | undefined>;
};

export type DisplayInputs = {
  readonly layers: ReadonlyArray<Layer>;
  readonly layerByColor: Map<string, Layer>;
  readonly displayPolylineCache: DisplayPolylineCache | undefined;
  readonly mode: ObjectDisplayMode;
  readonly palette: ArtworkPalette;
};

type Remembered = {
  readonly layers: ReadonlyArray<Layer>;
  readonly cache: DisplayPolylineCache | undefined;
  readonly mode: ObjectDisplayMode;
  readonly palette: ArtworkPalette;
  readonly display: ObjectDisplay;
};

const remembered = new WeakMap<VectorSceneObject, Remembered>();

export function placeObjects(
  ctx: CanvasRenderingContext2D,
  objects: ReadonlyArray<SceneObject>,
  view: ViewTransform,
  inputs: DisplayInputs,
): PlacedScene {
  const planned: Array<ResolvedVector | undefined> = [];
  const placed = objects.map((obj): PlacedObject => {
    const isVisible = sceneLayerVisibility.hasObject(obj, inputs.layerByColor);
    const onCanvas = isVisible && objectIntersectsCanvas(obj, view, ctx.canvas);
    if (!isVisible || !isVectorSceneObject(obj)) {
      planned.push(undefined);
      return { isVisible, onCanvas, vector: undefined };
    }
    const display = onCanvas ? resolved(obj, view, inputs) : lastDisplay(obj, view, inputs);
    const vector = { object: obj, display };
    planned.push(vector);
    return { isVisible, onCanvas, vector: onCanvas ? vector : undefined };
  });
  return { placed, planned };
}

function resolved(
  obj: VectorSceneObject,
  view: ViewTransform,
  inputs: DisplayInputs,
): ObjectDisplay {
  const display = resolveObjectDisplay(
    obj,
    inputs.layerByColor,
    view,
    inputs.displayPolylineCache,
    inputs.mode,
    inputs.palette,
  );
  remembered.set(obj, {
    layers: inputs.layers,
    cache: inputs.displayPolylineCache,
    mode: inputs.mode,
    palette: inputs.palette,
    display,
  });
  return display;
}

function lastDisplay(
  obj: VectorSceneObject,
  view: ViewTransform,
  inputs: DisplayInputs,
): ObjectDisplay {
  const last = remembered.get(obj);
  return last !== undefined &&
    last.layers === inputs.layers &&
    last.cache === inputs.displayPolylineCache &&
    last.mode === inputs.mode &&
    last.palette === inputs.palette
    ? last.display
    : resolved(obj, view, inputs);
}

/** Whether the object at this place draws anything besides the pools queued before it. */
export function drawsBesidePools(
  obj: SceneObject,
  place: PlacedObject,
  display: ObjectDisplay | undefined,
  selectedIds: { readonly selectedId: string | null; readonly additional: ReadonlySet<string> },
): boolean {
  if (place.vector !== undefined && display !== undefined && display.paths.length > 0) return true;
  if (place.onCanvas && (obj.kind === 'raster-image' || obj.kind === 'relief')) return true;
  return (
    place.isVisible && (obj.id === selectedIds.selectedId || selectedIds.additional.has(obj.id))
  );
}
