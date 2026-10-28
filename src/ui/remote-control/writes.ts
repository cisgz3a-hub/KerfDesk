import { IDENTITY_TRANSFORM, type ShapeObject } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { DEFAULT_TEXT_COLOR } from '../../core/text';
import type { AppState } from '../state/store';
import type { RemoteAppStore, RemoteWrite } from './types';
import { showKeptFeedsOnPc, updateOperationFull } from './design-operations';
import { editableArtwork, expandedArtworkGroupIds, prepareTransforms } from './transforms';
import { prepareRemoteText } from './text';
import { editableText, prepareTextEdit } from './text-edit';
import {
  missingGlyphNoticeFields,
  showMissingGlyphsOnPc,
  type MissingGlyphReport,
} from './text-notices';
import { applyHistory, prepareArrange } from './arrange';
import { publicIdentifier, selectedIds } from './projections';
import { prepareRemoteShape } from './touch-shapes';
import { prepareRemoteSelection } from './selection';
import { deliverBoardPhoto, placeOnBoard, prepareBoardPhoto, preparePlaceOnBoard } from './board';
import { RemoteFault } from './fault';

export async function applyRemoteWrite(
  write: RemoteWrite,
  store: RemoteAppStore,
  signal: AbortSignal,
  assertCurrent: () => void,
  commit: (action: () => Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertCurrent();
  const state = store.getState();
  if (isBoardWrite(write)) return applyBoardWrite(write, state, store, commit);
  return applyOrdinaryRemoteWrite(write, state, store, signal, commit);
}

type BoardWrite = Extract<RemoteWrite, { readonly command: 'set_board_photo' | 'place_on_board' }>;
type OrdinaryWrite = Exclude<RemoteWrite, BoardWrite>;

function isBoardWrite(write: RemoteWrite): write is BoardWrite {
  return write.command === 'set_board_photo' || write.command === 'place_on_board';
}

function applyBoardWrite(
  write: BoardWrite,
  state: AppState,
  store: RemoteAppStore,
  commit: (action: () => Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  if (write.command === 'set_board_photo') {
    const file = prepareBoardPhoto(write.args);
    return commit(() => deliverBoardPhoto(file));
  }
  const prepared = preparePlaceOnBoard(state, write.args);
  return commit(() => placeOnBoard(store, prepared));
}

async function applyOrdinaryRemoteWrite(
  write: OrdinaryWrite,
  state: AppState,
  store: RemoteAppStore,
  signal: AbortSignal,
  commit: (action: () => Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (write.command) {
    case 'set_selection': {
      const ids = prepareRemoteSelection(state, write.args);
      return commit(() => {
        state.selectObjects(ids, {
          scope: 'document',
          expandGroups: false,
          preserveExisting: true,
        });
        return { selection: selectedIds(store.getState()).filter(publicIdentifier).slice(0, 200) };
      });
    }
    case 'add_rectangle':
      return commit(() => addRectangle(store, write.args));
    case 'add_ellipse':
    case 'add_polyline': {
      const object = prepareRemoteShape(state, write);
      return commit(() => drawShape(store, object));
    }
    case 'add_text':
      return addText(write.args, store, signal, commit);
    case 'transform_artwork': {
      const ids = expandedArtworkGroupIds(state, write.args.artworkIds);
      const objects = editableArtwork(state, ids);
      const transforms = prepareTransforms(objects, write.args.transform);
      return commit(() => {
        state.applySelectionTransforms(transforms);
        return { changedArtworkIds: ids };
      });
    }
    case 'update_operation': {
      const { operationId, patch } = write.args;
      const receipt = commit(() => updateOperationFull(store, operationId, patch));
      showKeptFeedsOnPc(receipt.message);
      return receipt;
    }
    case 'update_text':
      return updateText(write.args, state, store, signal, commit);
    case 'arrange_artwork': {
      const action = prepareArrange(state, store, write.args.artworkIds, write.args.action);
      return commit(action);
    }
    case 'undo':
    case 'redo':
      return commit(() => applyHistory(state, store, write.command));
  }
}

type Commit = (action: () => Record<string, unknown>) => Record<string, unknown>;

async function addText(
  args: Extract<RemoteWrite, { command: 'add_text' }>['args'],
  store: RemoteAppStore,
  signal: AbortSignal,
  commit: Commit,
): Promise<Record<string, unknown>> {
  const { object, missingCharacters } = await prepareRemoteText(args, signal);
  const report: MissingGlyphReport = {
    fontKey: object.fontKey,
    missing: missingCharacters,
    embeddedFonts: undefined,
    clientWording: true,
  };
  const receipt = commit(() => {
    store.getState().upsertTextObject(object, undefined, { placement: 'canvas' });
    return { changedArtworkIds: [object.id], ...missingGlyphNoticeFields(report) };
  });
  showMissingGlyphsOnPc(report);
  return receipt;
}

async function updateText(
  args: Extract<RemoteWrite, { command: 'update_text' }>['args'],
  state: AppState,
  store: RemoteAppStore,
  signal: AbortSignal,
  commit: Commit,
): Promise<Record<string, unknown>> {
  const object = editableText(state, args.artworkId);
  const prepared = await prepareTextEdit(state, object, args.patch, signal);
  const report: MissingGlyphReport = {
    fontKey: prepared.object.fontKey,
    missing: prepared.missingCharacters,
    embeddedFonts: state.project.embeddedFonts,
    clientWording: args.patch.text !== undefined,
  };
  const receipt = commit(() => {
    if (prepared.changedFields.length > 0)
      store.getState().upsertTextObject(prepared.object, undefined, { placement: 'canvas' });
    return {
      changedArtworkIds: prepared.changedFields.length > 0 ? [object.id] : [],
      changedFields: prepared.changedFields,
      ...missingGlyphNoticeFields(report),
    };
  });
  showMissingGlyphsOnPc(report);
  return receipt;
}

// ADR-584: CNC workspaces create the same ordinary artwork; CNC defaults seed fresh layers.
function addRectangle(
  store: RemoteAppStore,
  args: Extract<RemoteWrite, { command: 'add_rectangle' }>['args'],
) {
  const id = crypto.randomUUID();
  return drawShape(
    store,
    createRectangle({
      id,
      color: DEFAULT_TEXT_COLOR,
      spec: { widthMm: args.widthMm, heightMm: args.heightMm, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: args.xMm, y: args.yMm },
    }),
  );
}

function drawShape(store: RemoteAppStore, object: ShapeObject) {
  store.getState().drawShape(object);
  // Desktop drawing can refuse an insertion with a warning and no state change.
  if (!store.getState().project.scene.objects.some((item) => item.id === object.id))
    throw new RemoteFault('failed');
  return { changedArtworkIds: [object.id] };
}
