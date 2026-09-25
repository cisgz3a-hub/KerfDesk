import {
  addLayer,
  addObject,
  createArtworkOperations,
  type Bounds,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { validateSceneBudgets } from '../../io/project/project-scene-integrity-validator';
import { svgObjectMatrix } from '../../io/svg/export-svg-paths';
import { inverseSvgMatrix, svgMatrixToSceneTransform } from '../../io/svg/svg-scene-transform';
import { multiplySvgMatrix, translateSvgMatrix } from '../../io/svg/svg-transform-attribute';
import type { SvgMatrix } from '../../io/svg/svg-curve-transform';
import {
  pruneOrphanLayers,
  pushUndo,
  type StateSlice,
  type ImportOutcome,
} from './scene-mutations';
import { repairDanglingObjectDependencies } from './object-delete-actions';
import { removeObjectIdsFromGroups } from './scene-group-actions';
import {
  inheritSvgComponentOperations,
  matchSvgSourceComponents,
  replaceSvgArtworkOrder,
  replaceSvgGroups,
  svgSourceMode,
} from './svg-fragment-reimport';

export type SvgFragmentActions = {
  readonly importSvgObject: (object: SceneObject, batchOffsetIdx?: number) => ImportOutcome;
  readonly reimportSvgObject: (targetObjectId: string, object: SceneObject) => ImportOutcome | null;
  readonly importSvgFragment: (fragment: SvgArtworkFragment, batchIndex?: number) => ImportOutcome;
  readonly reimportSvgFragment: (
    targetId: string,
    fragment: SvgArtworkFragment,
  ) => ImportOutcome | null;
};

export type SvgArtworkFragment = {
  readonly source: string;
  readonly bounds: Bounds;
  readonly objects: readonly SceneObject[];
};

/** One file is one placement and one history entry, including every bitmap. */
export function applySvgFragmentImport(
  state: StateSlice,
  fragment: SvgArtworkFragment,
  batchIndex: number,
) {
  const { bounds } = fragment;
  const offset = 10 * batchIndex;
  const placement = translateSvgMatrix(
    state.project.device.bedWidth / 2 - (bounds.minX + bounds.maxX) / 2 + offset,
    state.project.device.bedHeight / 2 - (bounds.minY + bounds.maxY) / 2 + offset,
  );
  const prepared = appendFragment(state.project.scene, fragment, placement);
  return fragmentMutation(state, prepared.scene, prepared.ids);
}

export function sourceFragmentObjects(scene: Scene, target: SceneObject): readonly SceneObject[] {
  const id = target.svgImport?.id;
  return id === undefined
    ? [target]
    : scene.objects.filter((object) => object.svgImport?.id === id);
}

export function applySvgFragmentReimport(
  state: StateSlice,
  targetId: string,
  fragment: SvgArtworkFragment,
) {
  const target = state.project.scene.objects.find((object) => object.id === targetId);
  if (target === undefined || (target.kind !== 'imported-svg' && target.kind !== 'raster-image'))
    return null;
  const previous = sourceFragmentObjects(state.project.scene, target);
  const removed = new Set(previous.map((object) => object.id));
  const placement =
    target.svgImport === undefined
      ? svgObjectMatrix(target.transform)
      : multiplySvgMatrix(
          svgObjectMatrix(target.transform),
          inverseSvgMatrix(svgObjectMatrix(target.svgImport.transform)),
        );
  const original = state.project.scene;
  const insertionIndex = original.objects.findIndex((object) => removed.has(object.id));
  const base = removeObjectIdsFromGroups(
    {
      ...original,
      objects: original.objects.filter((object) => !removed.has(object.id)),
      ...(original.artworkOrder === undefined
        ? {}
        : { artworkOrder: original.artworkOrder.filter((id) => !removed.has(id)) }),
    },
    removed,
  );
  const matched = matchSvgSourceComponents(previous, fragment.objects);
  const prepared = appendFragment(base, fragment, placement, matched, original);
  const inserted = prepared.scene.objects.slice(base.objects.length);
  const objects = [
    ...base.objects.slice(0, insertionIndex),
    ...inserted,
    ...base.objects.slice(insertionIndex),
  ];
  const artworkOrder = replaceSvgArtworkOrder(original, removed, prepared.ids);
  const repaired = repairDanglingObjectDependencies({
    ...prepared.scene,
    objects,
    groups: replaceSvgGroups(original, removed, prepared.scene, prepared.ids),
    ...(artworkOrder === undefined ? {} : { artworkOrder }),
  });
  const scene = pruneOrphanLayers(repaired.scene);
  const kept = matched.filter((object) => object !== undefined).length;
  return {
    state: fragmentMutation(state, scene, prepared.ids),
    outcome: {
      kind: 'replaced' as const,
      source: fragment.source,
      kept,
      added: inserted.length - kept,
      removed: previous.length - kept,
    },
  };
}

function appendFragment(
  base: Scene,
  fragment: SvgArtworkFragment,
  placement: SvgMatrix,
  previous: readonly (SceneObject | undefined)[] = [],
  sourceScene: Scene = base,
): { readonly scene: Scene; readonly ids: readonly string[] } {
  if (fragment.objects.length === 0) throw new Error('SVG has no drawable content.');
  let scene = base;
  const ids: string[] = [];
  const importId = crypto.randomUUID();
  for (const [index, incoming] of fragment.objects.entries()) {
    const prior = previous[index];
    const next = prepareFragmentObject(scene, incoming, prior, {
      placement,
      source: fragment.source,
      importId,
      sourceScene,
    });
    scene = next.scene;
    const object = next.object;
    scene = addObject(scene, object);
    ids.push(object.id);
  }
  if (ids.length > 1)
    scene = {
      ...scene,
      groups: [
        ...(scene.groups ?? []),
        { id: crypto.randomUUID(), name: fragment.source, objectIds: ids },
      ],
    };
  return { scene, ids };
}

function fragmentMutation(state: StateSlice, scene: Scene, ids: readonly string[]) {
  // Replacement may temporarily retain old operations while new ones are
  // allocated. Only the final, pruned scene is the persisted transaction.
  const error = validateSceneBudgets(scene);
  if (error !== null) throw new Error(error);
  const [primary, ...rest] = ids;
  return {
    project: { ...state.project, scene },
    selectedObjectId: primary ?? null,
    additionalSelectedIds: new Set(rest),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true as const,
  };
}

function prepareFragmentObject(
  scene: Scene,
  incoming: SceneObject,
  prior: SceneObject | undefined,
  context: {
    readonly placement: SvgMatrix;
    readonly source: string;
    readonly importId: string;
    readonly sourceScene: Scene;
  },
): { scene: Scene; object: SceneObject } {
  const { placement, source, importId, sourceScene } = context;
  let object: SceneObject = {
    ...incoming,
    id: prior?.kind === incoming.kind ? prior.id : incoming.id,
    transform: svgMatrixToSceneTransform(
      multiplySvgMatrix(placement, svgObjectMatrix(incoming.transform)),
    ),
    svgImport: {
      id: importId,
      source,
      transform: incoming.transform,
      mode: svgSourceMode(incoming),
    },
  };
  if (scene.objects.some((candidate) => candidate.id === object.id))
    throw new Error('SVG artwork identities collide.');
  if (prior?.kind === incoming.kind) {
    object = inheritSvgComponentOperations(object, prior, sourceScene);
  } else {
    const created = createArtworkOperations(scene, object, {
      mode: svgSourceMode(object),
    });
    object = created.object;
    for (const operation of created.operations) scene = addLayer(scene, operation);
  }
  return { scene, object };
}
