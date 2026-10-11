import { alignDelta, type SelectionAlignKind } from '../../scene/selection-align';
import type { SelectionDistributeKind } from '../../scene/selection-distribute';
import type { Bounds, Vec2 } from '../../scene';
import { entityBounds } from '../sketch-bounds';
import { sanitizeEntity, type Sketch, type SketchEntity } from '../sketch-entity';
import { translateEntity } from './translate-entities';

export type DesignAlignKind = Exclude<SelectionAlignKind, 'centers'>;
export type DesignDistributeKind = SelectionDistributeKind;

type PositionedEntity = { readonly entity: SketchEntity; readonly box: Bounds };
type EntityMove = { readonly entity: SketchEntity; readonly delta: Vec2 };

function selectedEntities(sketch: Sketch, ids: ReadonlySet<string>): PositionedEntity[] {
  // Match materialization: empty geometry contributes neither bounds nor an item.
  return sketch.entities.flatMap((entity) => {
    const clean = ids.has(entity.id) ? sanitizeEntity(entity) : null;
    return clean === null ? [] : [{ entity: clean, box: entityBounds(clean) }];
  });
}

/** Align against the selection's bounding box, retaining the outside edge. */
export function alignEntities(
  sketch: Sketch,
  ids: ReadonlySet<string>,
  kind: DesignAlignKind,
): Sketch {
  const selected = selectedEntities(sketch, ids);
  const first = selected[0];
  if (selected.length < 2 || first === undefined) return sketch;
  const reference = selected.reduce<Bounds>(
    (box, item) => ({
      minX: Math.min(box.minX, item.box.minX),
      minY: Math.min(box.minY, item.box.minY),
      maxX: Math.max(box.maxX, item.box.maxX),
      maxY: Math.max(box.maxY, item.box.maxY),
    }),
    first.box,
  );
  return moveByDeltas(
    sketch,
    new Map(
      selected.map(({ entity, box }) => [
        entity.id,
        { entity, delta: alignDelta(box, reference, kind) },
      ]),
    ),
  );
}

/** Keep the outermost items fixed and space the interior items evenly. */
export function distributeEntities(
  sketch: Sketch,
  ids: ReadonlySet<string>,
  kind: DesignDistributeKind,
): Sketch {
  const selected = selectedEntities(sketch, ids);
  if (selected.length < 3) return sketch;
  const horizontal = kind.startsWith('horizontal');
  const centers = kind.endsWith('centers');
  const min = (box: Bounds): number => (horizontal ? box.minX : box.minY);
  const max = (box: Bounds): number => (horizontal ? box.maxX : box.maxY);
  const position = (box: Bounds): number => (centers ? (min(box) + max(box)) / 2 : min(box));
  // Stable order resolves coincident objects without changing drawing order.
  const sorted = [...selected].sort((a, b) => position(a.box) - position(b.box));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return sketch;
  const totalSize = sorted.reduce((sum, item) => sum + max(item.box) - min(item.box), 0);
  const step = centers
    ? (position(last.box) - position(first.box)) / (sorted.length - 1)
    : (max(last.box) - min(first.box) - totalSize) / (sorted.length - 1);
  let cursor = centers ? position(first.box) + step : max(first.box) + step;
  const deltas = new Map<string, EntityMove>();
  for (const item of sorted.slice(1, -1)) {
    const delta = cursor - position(item.box);
    deltas.set(item.entity.id, {
      entity: item.entity,
      delta: horizontal ? { x: delta, y: 0 } : { x: 0, y: delta },
    });
    cursor += step + (centers ? 0 : max(item.box) - min(item.box));
  }
  return moveByDeltas(sketch, deltas);
}

function moveByDeltas(sketch: Sketch, deltas: ReadonlyMap<string, EntityMove>): Sketch {
  let changed = false;
  const entities = sketch.entities.map((entity) => {
    const move = deltas.get(entity.id);
    if (move === undefined) return entity;
    const { delta } = move;
    if (
      !Number.isFinite(delta.x) ||
      !Number.isFinite(delta.y) ||
      (Math.abs(delta.x) < 1e-9 && Math.abs(delta.y) < 1e-9)
    )
      return entity;
    changed = true;
    return translateEntity(move.entity, delta);
  });
  return changed ? { ...sketch, entities } : sketch;
}
