import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UNRESTRICTED_EDITION, setActiveEdition } from '../licensing/edition';
import {
  registerBoardRemote,
  useBoardPhotoInbox,
  type BoardRemoteStatus,
} from '../laser/board-capture/board-capture-remote';
import {
  burnedCellsPerPhoto,
  masksOverTheirPhotos,
  offImageAdvisories,
  setUpMaskedPhotoOnBoard,
} from '../state/board-array-masks.test-support';
import { useStore } from '../state/store';
import { resetStore, svgObj } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { REMOTE_IMPORT_BASE64_LIMIT } from './design-validation';
import { resultCode, testAdapter, writeArgs } from './authoring-test-support';
import type { RemoteControlAdapter } from './types';

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0x00];
const encode = (bytes: readonly number[]) => btoa(String.fromCharCode(...bytes));

let adapter: RemoteControlAdapter;
let unregister: (() => void) | null = null;

beforeEach(() => {
  resetStore();
  setActiveEdition(UNRESTRICTED_EDITION);
  useBoardPhotoInbox.setState({ photo: null });
  useUiStore.setState({ boardCapturePanelOpen: false });
  adapter = testAdapter();
});

afterEach(() => {
  unregister?.();
  unregister = null;
  adapter.dispose();
  setActiveEdition(null);
  useBoardPhotoInbox.setState({ photo: null });
});

function lockedEdition(): void {
  setActiveEdition({
    ...UNRESTRICTED_EDITION,
    pro: false,
    requestPro: () => false,
  });
}

function controllerStatus(): BoardRemoteStatus {
  return {
    panelOpen: true,
    shape: 'outline',
    committed: false,
    captures: 1,
    capturesNeeded: 2,
    hasOutlineDraft: true,
    coordinatesCurrent: true,
    busy: false,
    board: null,
  };
}

describe('get_board', () => {
  it('returns the registered panel controller status', async () => {
    const status = controllerStatus();
    unregister = registerBoardRemote({
      status: () => status,
      finishReview: () => ({ refusal: null, notice: null }),
      capture: async () => undefined,
      finish: async () => undefined,
    });
    const result = await adapter.execute('get_board', {});
    expect(result).toMatchObject({ ok: true, data: status });
  });

  it('projects a captured-board outline while the panel is closed', async () => {
    useStore.getState().addCapturedBoard({
      kind: 'outline',
      pointsMm: [
        { x: 0, y: 0 },
        { x: 120.04, y: 0 },
        { x: 90, y: 70.06 },
        { x: 0, y: 60 },
      ],
      anchorIndices: [0, 1, 2, 3],
    });
    const result = await adapter.execute('get_board', {});
    expect(result).toMatchObject({
      ok: true,
      data: {
        panelOpen: false,
        committed: true,
        board: { kind: 'outline', widthMm: 120, heightMm: 70.1 },
      },
    });
  });

  it('returns no board when no panel or captured outline exists', async () => {
    expect(await adapter.execute('get_board', {})).toMatchObject({
      ok: true,
      data: { panelOpen: false, committed: false, board: null },
    });
  });

  it('requires Pro', async () => {
    lockedEdition();
    expect(resultCode(await adapter.execute('get_board', {}))).toBe('needs_pro');
  });
});

describe('set_board_photo', () => {
  async function send(dataBase64: string, mimeType: 'image/png' | 'image/jpeg' = 'image/png') {
    return adapter.execute('set_board_photo', writeArgs(adapter, { mimeType, dataBase64 }));
  }

  it('rejects malformed base64, wrong magic and over-limit input', async () => {
    expect(resultCode(await send('!!!!'))).toBe('invalid_arguments');
    expect(resultCode(await send(encode(JPEG_BYTES), 'image/png'))).toBe('invalid_arguments');
    expect(resultCode(await send('A'.repeat(REMOTE_IMPORT_BASE64_LIMIT + 4)))).toBe(
      'invalid_arguments',
    );
  });

  it('requires Pro before delivering the photo', async () => {
    lockedEdition();
    expect(resultCode(await send(encode(PNG_BYTES)))).toBe('needs_pro');
    expect(useBoardPhotoInbox.getState().photo).toBeNull();
  });

  it('delivers a typed File and opens Place Board', async () => {
    const result = await send(encode(PNG_BYTES));
    expect(result).toMatchObject({ ok: true, data: { status: 'delivered' } });
    expect(useBoardPhotoInbox.getState().photo).toMatchObject({
      name: 'board-photo.png',
      type: 'image/png',
    });
    expect(useUiStore.getState().boardCapturePanelOpen).toBe(true);
  });

  it('rejects a stale revision before delivery', async () => {
    const result = await adapter.execute('set_board_photo', {
      expectedRevision: 'stale',
      requestId: crypto.randomUUID(),
      mimeType: 'image/png',
      dataBase64: encode(PNG_BYTES),
    });
    expect(resultCode(result)).toBe('stale_revision');
    expect(useBoardPhotoInbox.getState().photo).toBeNull();
  });
});

describe('place_on_board', () => {
  function setup(board = true): void {
    useStore.getState().importSvgObject(svgObj('art', ['#ff0000']));
    if (board) useStore.getState().addCapturedBoardBox(100, 80);
    adapter.dispose();
    adapter = testAdapter();
  }

  async function place(
    action: 'center' | 'fit' | 'array',
    extra: Record<string, unknown> = {},
    artworkIds: string[] = ['art'],
  ) {
    return adapter.execute('place_on_board', writeArgs(adapter, { artworkIds, action, ...extra }));
  }

  it('requires a captured board', async () => {
    setup(false);
    expect(resultCode(await place('center'))).toBe('not_found');
  });

  it.each(['center', 'fit'] as const)(
    '%s places artwork through the store action',
    async (action) => {
      setup();
      const before = useStore.getState().project.scene;
      expect(resultCode(await place(action, { marginMm: 5 }))).toBe('ok');
      expect(useStore.getState().project.scene).not.toBe(before);
    },
  );

  it('arrays one artwork selection on the board', async () => {
    setup();
    const before = useStore.getState().project.scene.objects.length;
    expect(resultCode(await place('array', { rows: 2, cols: 2, gapMm: 1 }))).toBe('ok');
    expect(useStore.getState().project.scene.objects.length).toBeGreaterThan(before);
  });

  // Rolling audit v5 J9-P1-1 (ADR-633 Amendment 3): each tile kept the
  // original's mask and burned a quarter of it.
  it('arrays a masked photo with its own mask in every tile', async () => {
    setUpMaskedPhotoOnBoard();
    adapter.dispose();
    adapter = testAdapter();
    const [whole] = burnedCellsPerPhoto();

    const result = await place('array', { rows: 2, cols: 2, gapMm: 2 }, ['photo']);
    expect(resultCode(result)).toBe('ok');
    expect(burnedCellsPerPhoto()).toEqual([whole, whole, whole, whole]);
    expect(masksOverTheirPhotos()).toEqual([true, true, true, true]);
    expect(offImageAdvisories()).toEqual([]);
  });

  it('rejects arraying multiple artwork IDs', async () => {
    setup();
    useStore.getState().importSvgObject(svgObj('other', ['#00ff00']));
    expect(resultCode(await place('array', {}, ['art', 'other']))).toBe('invalid_arguments');
  });

  it('requires Pro', async () => {
    setup();
    lockedEdition();
    expect(resultCode(await place('fit'))).toBe('needs_pro');
  });
});
