import type { Project, SceneObject } from '../../core/scene';
import { dispatchImportFilesInOrder } from '../app/import-dispatch';
import { useStore } from '../state';
import type { AppState, ImportOutcome } from '../state/store';
import { objectInsertActions } from '../state/object-insert-actions';
import { imageImportActions } from '../state/import-actions';
import { projectWithRefreshedReliefLinks } from '../state/relief-link-mutation';
import { pushUndo } from '../state/undo-stack';
import type { SvgArtworkFragment } from '../state/svg-fragment-mutation';
import { useToastStore } from '../state/toast-store';
import { snapshotFile, type StudioSnapshot } from './artcraft-api';
import { acceptStudioDocument } from './studio-project-bridge';

/** Re-import is explicit: normal picker imports intentionally create copies. */
export async function applyStudioSnapshot(
  snapshot: StudioSnapshot,
  ownerEpoch: number,
  isActive: () => boolean = () => true,
): Promise<void> {
  const current = () => {
    if (!isActive()) throw new Error('The editor panel closed. Nothing was applied.');
    const state = useStore.getState();
    if (state.projectDocumentEpoch !== ownerEpoch)
      throw new Error('The project changed. Apply again to the project you want to edit.');
    return state;
  };
  current();
  const file = await snapshotFile(snapshot);
  current();
  let committed = false;
  const commit = (fragment: SvgArtworkFragment, raster: boolean): ImportOutcome => {
    const state = current();
    let result: ImportOutcome = { kind: 'added' };
    const apply = (project: Project) => {
      result = commitArtwork(state, project, fragment, raster);
    };
    if (snapshot.nativeDocument === undefined) apply(state.project);
    else if (!acceptStudioDocument(snapshot.id, snapshot.nativeDocument, ownerEpoch, apply))
      throw new Error('The project changed while applying its native source.');
    committed = true;
    return result;
  };
  await dispatchImportFilesInOrder([file], {
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    importSvgFragment: (fragment) => commit(fragment, false),
    importSvgObject: (object) =>
      commit({ source: file.name, bounds: object.bounds, objects: [object] }, false),
    importRasterImage: (object) => {
      const sized = rasterDimensions(object, snapshot);
      return commit({ source: file.name, bounds: sized.bounds, objects: [sized] }, true);
    },
    pushToast: useToastStore.getState().pushToast,
  });
  current();
  if (!committed) throw new Error('No artwork was applied. Check the import notices for details.');
}

function commitArtwork(
  state: AppState,
  project: Project,
  fragment: SvgArtworkFragment,
  raster: boolean,
): ImportOutcome {
  // Existing import actions build a private candidate. Both source and artwork
  // validation precede the single project commit and its single Undo entry.
  let staged = { ...state, project };
  const set = (patch: (state: AppState) => Partial<AppState>) => {
    staged = { ...staged, ...patch(staged) };
  };
  const actions = {
    ...objectInsertActions(set, () => staged),
    ...imageImportActions(set, () => staged),
  };
  const target = studioTarget(project.scene.objects, fragment.source);
  const result =
    target === undefined
      ? raster && fragment.objects[0] !== undefined
        ? actions.importRasterImage(fragment.objects[0])
        : actions.importSvgFragment(fragment)
      : actions.reimportSvgFragment(target.id, fragment);
  if (result === null) throw new Error('The previously applied artwork is no longer available.');
  if (useStore.getState().project !== state.project)
    throw new Error('The project changed while applying artwork.');
  useStore.setState({
    project: projectWithRefreshedReliefLinks(staged.project),
    selectedObjectId: staged.selectedObjectId,
    additionalSelectedIds: staged.additionalSelectedIds,
    undoStack: pushUndo(state.project, state.undoStack, 'Apply studio artwork'),
    redoStack: [],
    dirty: true,
  });
  return result;
}

export function studioTarget(
  objects: readonly SceneObject[],
  source: string,
): SceneObject | undefined {
  const matches = objects.filter(
    (object) =>
      (object.kind === 'imported-svg' || object.kind === 'raster-image') &&
      (object.svgImport?.source === source || object.source === source),
  );
  const owners = new Set(matches.map((object) => object.svgImport?.id ?? object.id));
  if (owners.size > 1)
    throw new Error(
      'There are multiple copies of this editor session. Keep one copy before applying again.',
    );
  return matches[0];
}

function rasterDimensions(object: SceneObject, snapshot: StudioSnapshot): SceneObject {
  const { widthMm, heightMm } = snapshot;
  if (widthMm === undefined && heightMm === undefined) return object;
  if (
    widthMm === undefined ||
    heightMm === undefined ||
    !Number.isFinite(widthMm) ||
    !Number.isFinite(heightMm) ||
    widthMm <= 0 ||
    heightMm <= 0
  )
    throw new Error('The editor returned invalid physical dimensions.');
  return { ...object, bounds: { minX: 0, minY: 0, maxX: widthMm, maxY: heightMm } };
}
