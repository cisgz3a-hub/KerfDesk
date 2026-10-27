// Rolling audit v4 H8-P1-2 and H8-P2-3 (ADR-125 Amendment 2): a remote import
// says what the desktop import says. Each case runs the real desktop import
// action (the twin) and the real remote adapter on the same file and bed, and
// compares the artwork, the Undo steps, the PC toasts and the receipt.

import { File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { combinedBBox } from '../../core/scene/hit-test';
import { importDxfFiles } from '../app/dxf-import-action';
import { importSvgFiles } from '../app/svg-import-action';
import { importImageFile } from '../commands/import-image-action';
import { loadImageSamples, type LoadedImageSamples } from '../import/prepare-image-samples';
import { makePng } from '../import/png-incremental-decoder.test-support';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
import { resultCode, testAdapter, writeArgs } from './authoring-test-support';

// Bitmap storage only; parsing, placement and the store stay real.
vi.mock('../import/prepare-image-samples', () => ({ loadImageSamples: vi.fn() }));

const BED = { bedWidth: 400, bedHeight: 400 };
// 1000 x 500 mm with a text title the importer drops.
const PART_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1000mm" height="500mm" viewBox="0 0 1000 500">' +
  '<rect x="0" y="0" width="1000" height="500" fill="none" stroke="black"/>' +
  '<text x="10" y="20">Title</text></svg>';
const VERTICAL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L0 100" stroke="black"/></svg>';
// A 1000 x 500 unit line in US survey inches ($INSUNITS 22), which the table does not know.
const SURVEY_DXF =
  '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n22\n0\nENDSEC\n' +
  '0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n1000\n21\n500\n0\nENDSEC\n0\nEOF\n';

type Side = {
  readonly toasts: string[];
  readonly box: ReturnType<typeof combinedBBox>;
  readonly undoSteps: number;
  readonly afterOneUndo: ReturnType<typeof combinedBBox>;
  readonly afterTwoUndos: number;
};

function freshBed(): void {
  useStore.setState(useStore.getInitialState(), true);
  useStore.setState((state) => ({
    project: { ...state.project, device: { ...state.project.device, ...BED } },
  }));
  useToastStore.setState({ toasts: [] });
}

function undoRecord(toasts: string[]): Side {
  const state = useStore.getState();
  const box = combinedBBox(state.project.scene.objects);
  const undoSteps = state.undoStack.length;
  state.undo();
  const afterOneUndo = combinedBBox(useStore.getState().project.scene.objects);
  useStore.getState().undo();
  return {
    toasts,
    box,
    undoSteps,
    afterOneUndo,
    afterTwoUndos: useStore.getState().project.scene.objects.length,
  };
}

async function desktopImport(name: string, text: string): Promise<Side> {
  freshBed();
  const toasts: string[] = [];
  const pushToast = (message: string) => void toasts.push(message);
  const file = { name, text: async () => text };
  const store = useStore.getState();
  if (name.endsWith('.dxf')) {
    await importDxfFiles([file], { importObject: store.importSvgObject, pushToast });
  } else {
    await importSvgFiles([file], store.importSvgObject, pushToast, {
      importFragment: store.importSvgFragment,
    });
  }
  return undoRecord(toasts);
}

async function remoteImport(
  name: string,
  mimeType: string,
  dataBase64: string,
  placement: Record<string, number> = {},
): Promise<Side & { readonly receipt: Record<string, unknown> }> {
  freshBed();
  const adapter = testAdapter();
  try {
    const result = await adapter.execute(
      'import_file',
      writeArgs(adapter, { fileName: name, mimeType, dataBase64, ...placement }),
    );
    if (!result.ok) throw new Error(result.error.code);
    const toasts = useToastStore.getState().toasts.map((toast) => toast.message);
    return { ...undoRecord(toasts), receipt: result.data };
  } finally {
    adapter.dispose();
  }
}

const noticeMessages = (receipt: Record<string, unknown>) =>
  (receipt.notices as { message: string }[]).map((notice) => notice.message);

beforeEach(() => vi.stubGlobal('File', NodeFile));
afterEach(() => {
  vi.unstubAllGlobals();
  freshBed();
});

describe('a remote import reports and undoes its bed fit as the desktop import does', () => {
  it('SVG: the same fit, two Undo steps, and every desktop toast in the receipt and on the PC', async () => {
    const desktop = await desktopImport('part.svg', PART_SVG);
    const remote = await remoteImport('part.svg', 'image/svg+xml', btoa(PART_SVG));
    // The audit repro: 1000 x 500 mm on a 400 x 400 bed becomes 360 x 180 mm.
    expect(remote.box).toEqual(desktop.box);
    expect((remote.box?.maxX ?? 0) - (remote.box?.minX ?? 0)).toBeCloseTo(360, 6);
    expect(remote.undoSteps).toBe(2);
    expect(remote.undoSteps).toBe(desktop.undoSteps);
    // One Undo restores the file size; the second removes the import.
    expect(remote.afterOneUndo).toEqual(desktop.afterOneUndo);
    expect((remote.afterOneUndo?.maxX ?? 0) - (remote.afterOneUndo?.minX ?? 0)).toBeCloseTo(1000);
    expect(remote.afterTwoUndos).toBe(0);
    expect(remote.toasts).toEqual(desktop.toasts);
    expect(noticeMessages(remote.receipt)).toEqual(desktop.toasts);
    expect(desktop.toasts).toEqual(
      expect.arrayContaining([
        expect.stringContaining('1 text element ignored'),
        expect.stringMatching(/scaled to 36% to fit\. Undo restores the original size\.$/),
      ]),
    );
    expect(remote.receipt.bedFit).toEqual({
      scale: expect.closeTo(0.36, 9),
      fileWidthMm: 1000,
      fileHeightMm: 500,
      bedWidthMm: 400,
      bedHeightMm: 400,
    });
  });

  it('DXF: an unrecognised $INSUNITS and the fit reach the receipt and the PC', async () => {
    const desktop = await desktopImport('survey.dxf', SURVEY_DXF);
    const remote = await remoteImport('survey.dxf', 'application/dxf', btoa(SURVEY_DXF));
    expect(remote.box).toEqual(desktop.box);
    expect(remote.undoSteps).toBe(desktop.undoSteps);
    expect(remote.afterOneUndo).toEqual(desktop.afterOneUndo);
    expect(remote.toasts).toEqual(desktop.toasts);
    expect(noticeMessages(remote.receipt)).toEqual(desktop.toasts);
    expect(desktop.toasts).toEqual(
      expect.arrayContaining([
        'survey.dxf: Unrecognized $INSUNITS 22 — assuming millimeters.',
        expect.stringContaining('so it was scaled to 36% to fit'),
      ]),
    );
  });

  it('a requested position joins the fit step: Undo restores the file size, then removes it', async () => {
    const remote = await remoteImport('part.svg', 'image/svg+xml', btoa(PART_SVG), {
      xMm: 10,
      yMm: 20,
    });
    expect(remote.box?.minX).toBeCloseTo(10, 6);
    expect(remote.box?.minY).toBeCloseTo(20, 6);
    expect((remote.box?.maxX ?? 0) - (remote.box?.minX ?? 0)).toBeCloseTo(360, 6);
    expect(remote.undoSteps).toBe(2);
    expect((remote.afterOneUndo?.maxX ?? 0) - (remote.afterOneUndo?.minX ?? 0)).toBeCloseTo(1000);
    expect(remote.afterTwoUndos).toBe(0);
  });

  it('a requested width replaces the fitted size: one step, no fit notice', async () => {
    const remote = await remoteImport('part.svg', 'image/svg+xml', btoa(PART_SVG), {
      widthMm: 200,
    });
    expect((remote.box?.maxX ?? 0) - (remote.box?.minX ?? 0)).toBeCloseTo(200, 6);
    expect(remote.undoSteps).toBe(1);
    expect(remote.receipt.bedFit).toBeUndefined();
    expect(noticeMessages(remote.receipt).some((message) => message.includes('scaled to'))).toBe(
      false,
    );
    expect(noticeMessages(remote.receipt)).toContainEqual(
      expect.stringContaining('1 text element ignored'),
    );
  });
});

describe('an add_svg inside apply_edits', () => {
  it('stays one Undo step and says so; its toasts wait for the batch to commit', async () => {
    freshBed();
    const adapter = testAdapter();
    try {
      // A zero-width line cannot take a width, so the whole batch rolls back.
      const failed = await adapter.execute(
        'apply_edits',
        writeArgs(adapter, {
          edits: [
            { command: 'add_svg', args: { svg: PART_SVG } },
            { command: 'add_svg', args: { svg: VERTICAL_SVG, widthMm: 25 } },
          ],
        }),
      );
      expect(resultCode(failed)).toBe('unsupported_operation');
      expect(useStore.getState().undoStack).toHaveLength(0);
      expect(useToastStore.getState().toasts).toEqual([]);

      const result = await adapter.execute(
        'apply_edits',
        writeArgs(adapter, { edits: [{ command: 'add_svg', args: { svg: PART_SVG } }] }),
      );
      if (!result.ok) throw new Error(result.error.code);
      expect(useStore.getState().undoStack).toHaveLength(1);
      const [item] = result.data.results as Record<string, unknown>[];
      expect(item?.bedFit).toMatchObject({ scale: expect.closeTo(0.36, 9) });
      const notices = noticeMessages(item ?? {});
      expect(notices.at(-1)).toMatch(/Undo reverts the whole batch of remote edits\.$/);
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(notices);
    } finally {
      adapter.dispose();
    }
  });
});

describe('a remote raster import', () => {
  const png = makePng({ width: 2, height: 1, rows: [[0, 0, 0, 255, 255, 255]] });
  // A 20000 x 10000 px scan: far larger than the bed at any density.
  const scan: LoadedImageSamples = {
    kind: 'paged',
    natural: { width: 20000, height: 10000 },
    sampled: { width: 20000, height: 10000 },
    density: null,
    rollback: async () => null,
    imageAsset: {
      schemaVersion: 1,
      repository: 'curvedesk-import-assets-v1',
      sourceAssetId: 'source',
      lumaAssetId: 'luma',
      sourceMimeType: 'image/png',
      sourceByteLength: png.length,
      lumaByteLength: 200_000_000,
      naturalWidth: 20000,
      naturalHeight: 10000,
      sampledWidth: 20000,
      sampledHeight: 10000,
      thumbnail: {
        mimeType: 'image/bmp',
        dataUrl: 'data:image/bmp;base64,Qk0=',
        width: 2,
        height: 1,
      },
    },
  };

  it('keeps the image importer’s fit notice, which it lost before', async () => {
    vi.mocked(loadImageSamples).mockResolvedValue(scan);
    freshBed();
    const toasts: string[] = [];
    await importImageFile(
      new File([new Uint8Array(png)], 'scan.png', { type: 'image/png' }),
      (object) => useStore.getState().importRasterImage(object),
      (message) => void toasts.push(message),
    );
    const desktop = undoRecord(toasts);
    const remote = await remoteImport('scan.png', 'image/png', Buffer.from(png).toString('base64'));
    expect(remote.box).toEqual(desktop.box);
    expect(remote.undoSteps).toBe(2);
    expect(remote.afterOneUndo).toEqual(desktop.afterOneUndo);
    expect(remote.toasts).toEqual(desktop.toasts);
    expect(noticeMessages(remote.receipt)).toEqual(desktop.toasts);
    expect(desktop.toasts.at(-1)).toMatch(/^scan\.png is larger than the 400 × 400 mm bed/);
    expect(remote.receipt.bedFit).toMatchObject({ bedWidthMm: 400, bedHeightMm: 400 });
  });
});
