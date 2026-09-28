// Where a circular array is centred (LightBurn gap LBG-T14): the middle of the
// selection, a typed point, or one selected object, which then stays where it
// is and is not copied. KerfDesk keeps no selection order, so the dialog lists
// the selected objects, top-most first, instead of guessing which was last.

import { artworkOperationName } from '../../core/scene/artwork-operation';
import { combinedBBox } from '../../core/scene/hit-test';
import type { Bounds, SceneObject } from '../../core/scene/scene-object';
import { formatDisplayMillimetres } from '../format-display-millimetres';
import { sceneObjectCopyDependencyIds } from '../state/scene-object-copy-dependencies';

export type ArrayCentre =
  | { readonly kind: 'selection' }
  | { readonly kind: 'point' }
  | { readonly kind: 'object'; readonly id: string };

export type ArrayDialogContext = {
  /** The whole selection's bounds. */
  readonly bounds: Bounds;
  /** The selection in stacking order. */
  readonly selected: ReadonlyArray<SceneObject>;
};

type CentreFields = {
  readonly centre: ArrayCentre;
  readonly centerX: string;
  readonly centerY: string;
};

export type ResolvedCentre = { readonly x: number; readonly y: number; readonly objectId?: string };

/** The exact centre the array uses. A computed centre is never rounded to what the fields show. */
export function resolvedCentre(fields: CentreFields, context: ArrayDialogContext): ResolvedCentre {
  const { centre } = fields;
  if (centre.kind === 'point') {
    return { x: finiteNumber(fields.centerX), y: finiteNumber(fields.centerY) };
  }
  if (centre.kind === 'object') {
    const object = context.selected.find((candidate) => candidate.id === centre.id);
    const bounds = object === undefined ? null : combinedBBox([object]);
    if (bounds !== null) return { ...boundsCentre(bounds), objectId: centre.id };
  }
  return boundsCentre(context.bounds);
}

/** What the Center X and Y fields show: the typed point, or the computed centre to 0.01 mm. */
export function displayedCentre(
  fields: CentreFields,
  context: ArrayDialogContext,
): { readonly x: string; readonly y: string } {
  if (fields.centre.kind === 'point') return { x: fields.centerX, y: fields.centerY };
  const centre = resolvedCentre(fields, context);
  return { x: centre.x.toFixed(2), y: centre.y.toFixed(2) };
}

export type CentreObjectOption = { readonly id: string; readonly label: string };

/**
 * The selected objects the circle can centre on, top-most first. Offered only
 * when something else is left to copy, and never an object the rest of the
 * selection takes with it (a mask or a text's guide), which would move.
 */
export function centreObjectOptions(
  selected: ReadonlyArray<SceneObject>,
): ReadonlyArray<CentreObjectOption> {
  if (selected.length < 2) return [];
  const taken = new Set(
    selected.flatMap((object) =>
      sceneObjectCopyDependencyIds(object).filter((id) => id !== object.id),
    ),
  );
  return [...selected].reverse().flatMap((object) => {
    const bounds = combinedBBox([object]);
    if (taken.has(object.id) || bounds === null) return [];
    const centre = boundsCentre(bounds);
    const at = `${formatDisplayMillimetres(round2(centre.x))}, ${formatDisplayMillimetres(round2(centre.y))} mm`;
    return [{ id: object.id, label: `${artworkOperationName(object)} at ${at}` }];
  });
}

/** How far, and at what angle, the rest of the selection sits from object `id`'s centre. */
export function offsetFromObject(
  selected: ReadonlyArray<SceneObject>,
  id: string,
): { readonly radius: number; readonly angleDeg: number } | null {
  const object = selected.find((candidate) => candidate.id === id);
  const own = object === undefined ? null : combinedBBox([object]);
  const rest = combinedBBox(selected.filter((candidate) => candidate.id !== id));
  if (own === null || rest === null) return null;
  const dx = (rest.minX + rest.maxX - own.minX - own.maxX) / 2;
  const dy = (rest.minY + rest.maxY - own.minY - own.maxY) / 2;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { radius: Math.hypot(dx, dy), angleDeg: angleDeg < 0 ? angleDeg + 360 : angleDeg };
}

function boundsCentre(bounds: Bounds): { readonly x: number; readonly y: number } {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function finiteNumber(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}
