import { IDENTITY_TRANSFORM } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { DEFAULT_TEXT_COLOR } from '../../core/text';
import type { AppState } from '../state/store';
import type { RemoteAppStore, RemoteWrite } from './types';
import { updateOperationFull } from './design-operations';
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
      return commit(() => updateOperationFull(store, write.args.operationId, write.args.patch));
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
// ADR-584: CNC workspaces create the same ordinary artwork; CNC defaults seed fresh layers.
function addRectangle(
  state: AppState,
  args: Extract<RemoteWrite, { command: 'add_rectangle' }>['args'],
) {
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
