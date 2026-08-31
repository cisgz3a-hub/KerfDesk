import { orderedArtworkObjects } from './artwork-order';
import { operationIdsForObject, type Scene } from './scene';

export type ArtworkRunUnit = {
  readonly key: string;
  readonly objectIds: ReadonlyArray<string>;
  readonly operationIds: ReadonlyArray<string>;
};

type MutableArtworkRunUnit = {
  readonly key: string;
  readonly objectIds: string[];
  readonly operationIds: ReadonlyArray<string>;
};

/** Groups artwork only when every member has the same complete operation set. */
export function artworkRunUnits(scene: Scene): ReadonlyArray<ArtworkRunUnit> {
  const units: MutableArtworkRunUnit[] = [];
  const byOperationSet = new Map<string, number>();
  for (const object of orderedArtworkObjects(scene)) {
    const operationIds = operationIdsForObject(object, scene.layers);
    const groupingKey = operationIds.length === 0 ? null : operationIds.join('\u0000');
    const existingIndex = groupingKey === null ? undefined : byOperationSet.get(groupingKey);
    if (existingIndex === undefined) {
      const index = units.length;
      units.push({ key: object.id, objectIds: [object.id], operationIds });
      if (groupingKey !== null) byOperationSet.set(groupingKey, index);
      continue;
    }
    const existing = units[existingIndex];
    if (existing === undefined) continue;
    existing.objectIds.push(object.id);
  }
  return units.map((unit) => ({ ...unit, objectIds: [...unit.objectIds] }));
}

export function artworkRunUnitForObject(scene: Scene, objectId: string): ArtworkRunUnit | null {
  return artworkRunUnits(scene).find((unit) => unit.objectIds.includes(objectId)) ?? null;
}

/** Moves complete run units and returns the flattened persisted object order. */
export function moveArtworkRunUnitsToPosition(
  scene: Scene,
  movingObjectIds: ReadonlySet<string>,
  requestedPosition: number,
): ReadonlyArray<string> {
  const units = artworkRunUnits(scene);
  const movingKeys = new Set(
    units
      .filter((unit) => unit.objectIds.some((id) => movingObjectIds.has(id)))
      .map((unit) => unit.key),
  );
  if (movingKeys.size === 0) return units.flatMap((unit) => unit.objectIds);
  const moving = units.filter((unit) => movingKeys.has(unit.key));
  const remaining = units.filter((unit) => !movingKeys.has(unit.key));
  const normalizedPosition = Number.isFinite(requestedPosition) ? Math.round(requestedPosition) : 1;
  const insertionIndex = Math.min(remaining.length, Math.max(0, normalizedPosition - 1));
  return [
    ...remaining.slice(0, insertionIndex),
    ...moving,
    ...remaining.slice(insertionIndex),
  ].flatMap((unit) => unit.objectIds);
}
