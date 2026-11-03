// applyImportWhiteKnockout — the white-fill half of a fresh SVG import
// (ADR-686). White shapes painted over darker fills are cut out of them and
// left out, so the burn matches the logo instead of burning its white parts.
// Like the bed fit, the import as parsed is pushed to history first: one Undo
// puts the white shapes back on their own operation (which burns), and a
// second removes the import.

import { knockOutWhiteFills, type WhiteKnockout } from '../../core/geometry/white-fill-knockout';
import { sceneObjectUsesOperation, type Scene } from '../../core/scene';
import { pushUndo, type ImportOutcome, type MutationResult } from './scene-mutations';
import { removeObjectIdsFromGroups } from './scene-group-actions';

type ImportPlacement = Pick<MutationResult, 'project' | 'undoStack'> & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds?: ReadonlySet<string>;
};

export function applyImportWhiteKnockout<T extends ImportPlacement>(
  placed: T,
): { readonly state: T; readonly whiteKnockout?: WhiteKnockout } {
  const { project } = placed;
  const ids = new Set([placed.selectedObjectId, ...(placed.additionalSelectedIds ?? [])]);
  const imported = project.scene.objects.filter((object) => ids.has(object.id));
  const knockout = knockOutWhiteFills(imported);
  // A file whose white covers every darker shape would import as nothing.
  if (knockout === null || knockout.removedIds.size === imported.length) return { state: placed };
  const scene = withoutRemovedParts(project.scene, knockout.changed, knockout.removedIds);
  const kept = imported.map((object) => object.id).filter((id) => !knockout.removedIds.has(id));
  const [primary, ...rest] = kept;
  return {
    state: {
      ...placed,
      project: { ...project, scene },
      undoStack: pushUndo(project, placed.undoStack),
      selectedObjectId: primary ?? null,
      additionalSelectedIds: new Set(rest),
    },
    whiteKnockout: {
      whiteShapes: knockout.whiteShapes,
      removedObjects: knockout.removedIds.size,
    },
  };
}

/** Attach the knock-out to an import's outcome, for its notice. */
export function withWhiteKnockout(
  outcome: ImportOutcome,
  whiteKnockout: WhiteKnockout | undefined,
): ImportOutcome {
  return whiteKnockout === undefined ? outcome : { ...outcome, whiteKnockout };
}

function withoutRemovedParts(
  scene: Scene,
  changed: ReadonlyMap<string, Scene['objects'][number]>,
  removedIds: ReadonlySet<string>,
): Scene {
  const objects = scene.objects
    .filter((object) => !removedIds.has(object.id))
    .map((object) => changed.get(object.id) ?? object);
  const grouped = removeObjectIdsFromGroups({ ...scene, objects }, removedIds);
  // Only the operations the white shapes alone used go; an operation the
  // operator left empty elsewhere in the project stays.
  const before = scene.layers.filter((operation) =>
    scene.objects.some((object) => sceneObjectUsesOperation(object, operation)),
  );
  const orphaned = new Set(
    before
      .filter((operation) => !objects.some((object) => sceneObjectUsesOperation(object, operation)))
      .map((operation) => operation.id),
  );
  return {
    ...grouped,
    layers: grouped.layers.filter((operation) => !orphaned.has(operation.id)),
    ...(grouped.artworkOrder === undefined
      ? {}
      : { artworkOrder: grouped.artworkOrder.filter((id) => !removedIds.has(id)) }),
  };
}
