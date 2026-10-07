import { IDENTITY_TRANSFORM, type Layer } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { DEFAULT_TEXT_COLOR } from '../../core/text';
import type { AppState } from '../state/store';
import type { RemoteAppStore, RemoteOperationPatch, RemoteWrite } from './types';
import { RemoteFault } from './fault';
import { editableArtwork, expandedArtworkGroupIds, prepareTransforms } from './transforms';
import { prepareRemoteText } from './text';
import { editableText, prepareTextEdit } from './text-edit';
import { applyHistory, prepareArrange } from './arrange';
import { publicIdentifier, selectedIds } from './projections';
import { prepareRemoteShape } from './touch-shapes';

export async function applyRemoteWrite(
  write: RemoteWrite,
  store: RemoteAppStore,
  signal: AbortSignal,
  assertCurrent: () => void,
  commit: (action: () => Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertCurrent();
  const state = store.getState();
  switch (write.command) {
    case 'set_selection':
      editableArtwork(state, write.args.artworkIds);
      return commit(() => {
        state.selectObjects(write.args.artworkIds);
        return { selection: selectedIds(store.getState()).filter(publicIdentifier).slice(0, 200) };
      });
    case 'add_rectangle':
      return commit(() => addRectangle(state, write.args));
    case 'add_ellipse':
    case 'add_polyline': {
      const object = prepareRemoteShape(state, write);
      return commit(() => {
        store.getState().drawShape(object);
        return { changedArtworkIds: [object.id] };
      });
    }
    case 'add_text': {
      requireLaser(state);
      const object = await prepareRemoteText(write.args, signal);
      return commit(() => {
        store.getState().upsertTextObject(object, undefined, { placement: 'canvas' });
        return { changedArtworkIds: [object.id] };
      });
    }
    case 'transform_artwork': {
      const ids = expandedArtworkGroupIds(state, write.args.artworkIds);
      const objects = editableArtwork(state, ids);
      const transforms = prepareTransforms(objects, write.args.transform);
      return commit(() => {
        state.applySelectionTransforms(transforms);
        return { changedArtworkIds: ids };
      });
    }
    case 'update_operation':
      return commit(() => updateOperation(state, write.args.operationId, write.args.patch));
    case 'update_text': {
      const object = editableText(state, write.args.artworkId);
      const prepared = await prepareTextEdit(state, object, write.args.patch, signal);
      return commit(() => {
        if (prepared.changedFields.length > 0)
          store.getState().upsertTextObject(prepared.object, undefined, { placement: 'canvas' });
        return {
          changedArtworkIds: prepared.changedFields.length > 0 ? [object.id] : [],
          changedFields: prepared.changedFields,
        };
      });
    }
    case 'arrange_artwork': {
      const action = prepareArrange(state, store, write.args.artworkIds, write.args.action);
      return commit(action);
    }
    case 'undo':
    case 'redo':
      return commit(() => applyHistory(state, store, write.command));
  }
}
function requireLaser(state: AppState): void {
  if (state.project.machine?.kind === 'cnc') throw new RemoteFault('unsupported_operation');
}
function addRectangle(
  state: AppState,
  args: Extract<RemoteWrite, { command: 'add_rectangle' }>['args'],
) {
  requireLaser(state);
  const id = crypto.randomUUID();
  state.drawShape(
    createRectangle({
      id,
      color: DEFAULT_TEXT_COLOR,
      spec: { widthMm: args.widthMm, heightMm: args.heightMm, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: args.xMm, y: args.yMm },
    }),
  );
  return { changedArtworkIds: [id] };
}
function updateOperation(state: AppState, id: string, patch: RemoteOperationPatch) {
  if (!publicIdentifier(id)) throw new RemoteFault('unsupported_operation');
  requireLaser(state);
  const layer = state.project.scene.layers.find((candidate) => candidate.id === id);
  if (layer === undefined) throw new RemoteFault('not_found');
  const updates: Partial<Omit<Layer, 'id' | 'color'>> = {
    ...(patch.powerPercent === undefined ? {} : { power: patch.powerPercent }),
    ...(patch.speedMmPerMin === undefined ? {} : { speed: patch.speedMmPerMin }),
    ...(patch.passes === undefined ? {} : { passes: patch.passes }),
    ...(patch.enabled === undefined ? {} : { output: patch.enabled }),
  };
  const changedFields = (Object.keys(patch) as (keyof RemoteOperationPatch)[]).filter((key) => {
    const source = {
      powerPercent: layer.power,
      speedMmPerMin: layer.speed,
      passes: layer.passes,
      enabled: layer.output,
    };
    return patch[key] !== source[key];
  });
  if (changedFields.length > 0) state.setLayerParam(id, updates);
  return { operationId: id, changedFields };
}
