// applyImportWhiteKnockout — the white-fill half of a fresh SVG import
// (ADR-686). White shapes painted over darker fills are cut out of them and
// left out, so the burn matches the logo instead of burning its white parts.
// Like the bed fit, the import as parsed is pushed to history first: one Undo
// puts the white shapes back on their own operation (which burns), and a
// second removes the import. The history copy marks those shapes `kept`
// (ADR-686 Amendment 3), so a project the operator chose to burn white in is
// never offered the knock-out again on open, and an unchanged Re-import keeps
// that choice.

import {
  countInkWhiteFills,
  isPaperWhite,
  knockOutWhiteFills,
  type WhiteKnockout,
} from '../../core/geometry/white-fill-knockout';
import {
  sceneObjectUsesOperation,
  type ColoredPath,
  type Project,
  type Scene,
} from '../../core/scene';
import { pushUndo, type ImportOutcome, type MutationResult } from './scene-mutations';
import { removeObjectIdsFromGroups } from './scene-group-actions';

type ImportPlacement = Pick<MutationResult, 'project' | 'undoStack'> & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds?: ReadonlySet<string>;
};

export function applyImportWhiteKnockout<T extends ImportPlacement>(
  placed: T,
): {
  readonly state: T;
  readonly whiteKnockout?: WhiteKnockout;
  readonly removedIds?: ReadonlySet<string>;
} {
  const { project } = placed;
  const ids = new Set([placed.selectedObjectId, ...(placed.additionalSelectedIds ?? [])]);
  const imported = project.scene.objects.filter((object) => ids.has(object.id));
  const knockout = knockOutWhiteFills(imported);
  const inkWhites = countInkWhiteFills(imported);
  // A file whose white covers every darker shape would import as nothing.
  if (knockout === null || knockout.removedIds.size === imported.length) {
    return inkWhites === 0
      ? { state: placed }
      : {
          state: placed,
          whiteKnockout: { whiteShapes: 0, removedObjects: 0, knockedShapes: 0, inkWhites },
        };
  }
  const scene = withoutRemovedParts(project.scene, knockout.changed, knockout.removedIds);
  const kept = imported.map((object) => object.id).filter((id) => !knockout.removedIds.has(id));
  const [primary, ...rest] = kept;
  return {
    state: {
      ...placed,
      project: { ...project, scene },
      undoStack: pushUndo(withWhiteKept(project, ids), placed.undoStack),
      selectedObjectId: primary ?? null,
      additionalSelectedIds: new Set(rest),
    },
    removedIds: knockout.removedIds,
    whiteKnockout: {
      whiteShapes: knockout.whiteShapes,
      removedObjects: knockout.removedIds.size,
      knockedShapes: knockout.knockedShapes,
      inkWhites,
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

/**
 * A Re-import's counts once the knock-out has removed white-only parts: a
 * new part it removed was never added, and a kept one it removed is removed.
 */
export function reimportCountsAfterKnockout(
  outcome: Extract<ImportOutcome, { kind: 'replaced' }>,
  removedIds: ReadonlySet<string> | undefined,
  priorIds: ReadonlySet<string>,
): Extract<ImportOutcome, { kind: 'replaced' }> {
  if (removedIds === undefined || removedIds.size === 0) return outcome;
  const keptRemoved = [...removedIds].filter((id) => priorIds.has(id)).length;
  const newRemoved = removedIds.size - keptRemoved;
  return {
    ...outcome,
    kept: outcome.kept - keptRemoved,
    added: outcome.added - newRemoved,
    removed: outcome.removed + keptRemoved,
  };
}

/**
 * The project with the paper whites of `objectIds` marked as the operator's
 * choice to burn them. `include` narrows which white paths count.
 */
export function withWhiteKept(
  project: Project,
  objectIds: ReadonlySet<string | null>,
  include: (object: Scene['objects'][number], path: ColoredPath) => boolean = () => true,
): Project {
  const objects = project.scene.objects.map((object) => {
    if (!objectIds.has(object.id) || object.kind !== 'imported-svg') return object;
    if (!object.paths.some(isPaperWhite)) return object;
    return {
      ...object,
      paths: object.paths.map((path) =>
        isPaperWhite(path) && include(object, path) ? { ...path, whiteInk: 'kept' as const } : path,
      ),
    };
  });
  return { ...project, scene: { ...project.scene, objects } };
}

export function withoutRemovedParts(
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
