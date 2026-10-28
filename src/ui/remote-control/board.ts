import { findRegistrationBoxes, type TileLayout, transformedBBox } from '../../core/scene';
import type { BoardArrayPlan } from '../../core/scene/board-array-plan';
import { MAX_TILE_PER_AXIS, MAX_TILE_TOTAL } from '../../core/scene/tile-into-region';
import { proFeaturesUnlocked } from '../licensing/edition';
import {
  currentBoardRemote,
  useBoardPhotoInbox,
} from '../laser/board-capture/board-capture-remote';
import { selectionBoardArrayPlan } from '../state/board-tile-actions';
import type { AppState } from '../state/store';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { REMOTE_IMPORT_BASE64_LIMIT } from './design-validation';
import { RemoteFault } from './fault';
import { editableArtwork } from './transforms';
import type { RemoteAppStore, RemoteWrite } from './types';

type BoardPhotoArgs = Extract<RemoteWrite, { command: 'set_board_photo' }>['args'];
type PlaceBoardArgs = Extract<RemoteWrite, { command: 'place_on_board' }>['args'];

export function boardProjection(store: RemoteAppStore): Record<string, unknown> {
  requirePro();
  const remote = currentBoardRemote();
  if (remote !== null) return remote.status();
  const board = findRegistrationBoxes(store.getState().project.scene).find(
    (object) => object.provenance === 'captured-board',
  );
  if (board === undefined) return { panelOpen: false, committed: false, board: null };
  const bounds = transformedBBox(board);
  return {
    panelOpen: false,
    committed: true,
    board: {
      kind:
        board.spec.kind === 'rect' ? 'rect' : board.spec.kind === 'ellipse' ? 'circle' : 'outline',
      widthMm: roundMm(bounds.maxX - bounds.minX),
      heightMm: roundMm(bounds.maxY - bounds.minY),
    },
  };
}

export function prepareBoardPhoto(args: BoardPhotoArgs): File {
  requirePro();
  if (!strictBase64(args.dataBase64)) throw new RemoteFault('invalid_arguments');
  const bytes = decode(args.dataBase64);
  const magic = args.mimeType === 'image/png' ? PNG : JPEG;
  if (!starts(bytes, magic)) throw new RemoteFault('invalid_arguments');
  const extension = args.mimeType === 'image/png' ? 'png' : 'jpg';
  return new File([bytes.buffer as ArrayBuffer], `board-photo.${extension}`, {
    type: args.mimeType,
  });
}

export function deliverBoardPhoto(file: File): Record<string, unknown> {
  useBoardPhotoInbox.getState().deliver(file);
  useUiStore.setState({ boardCapturePanelOpen: true });
  return { status: 'delivered' };
}

export function preparePlaceOnBoard(state: AppState, args: PlaceBoardArgs): PlaceBoardArgs {
  requirePro();
  const captured = findRegistrationBoxes(state.project.scene).some(
    (board) => board.provenance === 'captured-board',
  );
  if (!captured) throw new RemoteFault('not_found');
  editableArtwork(state, args.artworkIds);
  return args;
}

export function placeOnBoard(store: RemoteAppStore, args: PlaceBoardArgs): Record<string, unknown> {
  const state = store.getState();
  state.selectObjects(args.artworkIds, { scope: 'document', expandGroups: false });
  const selected = store.getState();
  const before = selected.project.scene;
  const marginMm = args.marginMm ?? 0;
  let counts: ArrayCounts | null = null;
  if (args.action === 'center') selected.fitSelectionToBoard({ mode: 'keep-size', marginMm });
  if (args.action === 'fit') selected.fitSelectionToBoard({ mode: 'fit', marginMm });
  if (args.action === 'array') counts = tileBoardSelection(selected, args, marginMm);
  if (store.getState().project.scene === before) throw new RemoteFault('unsupported_operation');
  const receipt = { status: 'placed', action: args.action, artworkCount: args.artworkIds.length };
  if (counts === null) return receipt;
  // The PC shows the shortfall too, as the desktop form does before Array on board.
  for (const notice of counts.notices) {
    useToastStore.getState().pushToast(notice.message, 'warning');
  }
  const notices = counts.notices.length > 0 ? { notices: counts.notices } : {};
  return { ...receipt, ...counts.fields, ...notices };
}

type ArrayCounts = {
  readonly fields: { readonly placedCount: number; readonly requestedCount?: number };
  readonly notices: ReadonlyArray<{ readonly level: 'warning'; readonly message: string }>;
};

// Null only when there is no board or design, and then the store changes nothing.
function tileBoardSelection(
  state: AppState,
  args: PlaceBoardArgs,
  marginMm: number,
): ArrayCounts | null {
  const gap = args.gapMm ?? 0;
  const layout: TileLayout =
    args.rows === undefined
      ? { kind: 'fill', gapXMm: gap, gapYMm: gap, marginMm }
      : {
          kind: 'grid',
          rows: args.rows,
          cols: args.cols as number,
          gapXMm: gap,
          gapYMm: gap,
          marginMm,
        };
  const plan = selectionBoardArrayPlan(state, layout)?.plan;
  state.tileSelectionIntoBoard(layout);
  return plan === undefined ? null : arrayCounts(plan);
}

/**
 * ADR-125 Amendment 4 (rolling audit v7 L4-P2-2): the receipt names how many copies were placed
 * and asked for, and a notice says why fewer were placed, as the desktop form's
 * "20 fit; 25 requested." and its cap line do.
 */
function arrayCounts(plan: BoardArrayPlan): ArrayCounts {
  const placed = plan.offsets.length;
  const requested = plan.requestedCount;
  const fields =
    requested === null
      ? { placedCount: placed }
      : { placedCount: placed, requestedCount: requested };
  if (!plan.limited && (requested === null || placed >= requested)) return { fields, notices: [] };
  const what =
    requested === null ? `${placed} copies` : `${placed} of the ${requested} requested copies`;
  const why = plan.limited
    ? `the layout is capped at ${MAX_TILE_PER_AXIS} per axis and ${MAX_TILE_TOTAL} copies`
    : 'no more fit on the board';
  return {
    fields,
    notices: [{ level: 'warning', message: `Array on board placed ${what}: ${why}.` }],
  };
}

function requirePro(): void {
  if (!proFeaturesUnlocked()) throw new RemoteFault('needs_pro');
}

function strictBase64(value: string): boolean {
  return (
    value.length >= 4 &&
    value.length <= REMOTE_IMPORT_BASE64_LIMIT &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(value)
  );
}

function decode(base64: string): Uint8Array {
  let raw: string;
  try {
    raw = atob(base64);
  } catch {
    throw new RemoteFault('invalid_arguments');
  }
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const starts = (bytes: Uint8Array, magic: readonly number[]) =>
  magic.every((value, index) => bytes[index] === value);
const roundMm = (value: number) => Math.round(value * 10) / 10;
