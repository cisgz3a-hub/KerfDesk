import type { SceneObject } from '../../core/scene';
import { transformedBBox } from '../../core/scene/hit-test';
import type { ParseDxfResult } from '../../io/dxf';
import type { ParseSvgResult } from '../../io/svg';
import { describeDxfImport } from '../app/dxf-import-action';
import type { ImportBedFitUndo } from '../app/import-bed-fit-notice';
import type { ToastDescriptor } from '../app/import-toasts';
import { describeSvgImport } from '../app/svg-import-action';
import { importImageFile } from '../commands/import-image-action';
import { parseSvgOffThread } from '../import/document-import-worker-client';
import { parseDxfOffThread } from '../import/import-worker-client';
import { prepareSvgFragment } from '../import/svg-image-hydration';
import { fitImportedObjectsToBed } from '../state/import-bed-fit';
import type { SelectionTransformEdit } from '../state/selection-transform-actions';
import type { ImportOutcome } from '../state/store';
import { fitAllObjects } from '../state/viewport-actions';
import { historyProjection } from './authoring-projections';
import { importNoticeFields, pushImportToasts, recordingPcToasts } from './design-import-notices';
import { inOneUndoStep } from './design-operations';
import { RemoteFault } from './fault';
import { publicIdentifier } from './projections';
import { prepareTransforms, validateTransforms } from './transforms';
import type { RemoteAppStore } from './types';

export type Placement = {
  readonly xMm?: number | undefined;
  readonly yMm?: number | undefined;
  readonly widthMm?: number | undefined;
};
/** The inserted artwork and the store outcome, with the bed fit when one was applied. */
type Placed = { readonly ids: string[]; readonly outcome: ImportOutcome };
/** A committed import and the PC toasts the desktop import would show for it. */
export type ImportReport = Placed & { readonly toasts: ReadonlyArray<ToastDescriptor> };
/** Parsed and hydrated off the commit path; `commit` is synchronous so it can join one Undo step. */
export type PreparedImport = {
  readonly commit: (store: RemoteAppStore, placement: Placement) => ImportReport;
  readonly accept: () => void;
  readonly dispose: () => Promise<void>;
};
type Commit = (action: () => Record<string, unknown>) => Record<string, unknown>;

// The store import places art at its file size; insertAndPlace applies the desktop's bed fit.
const AT_FILE_SIZE = { fitToBed: false } as const;

export async function prepareSvgImport(
  svg: string | Uint8Array<ArrayBuffer>,
  source: string,
  signal: AbortSignal,
): Promise<PreparedImport> {
  const result = await parseSvgInWorker(svg, source, signal);
  if (result.fragment !== undefined && result.fragment.entries.length > 0) {
    const prepared = await prepareSvgFragment(result.fragment, { signal });
    const fragment = {
      source: result.fragment.source,
      bounds: result.fragment.bounds,
      objects: prepared.objects,
    };
    let committed = false;
    return {
      commit: (store, placement) =>
        svgReport(source, result, store, placement, () => {
          store.getState().importSvgFragment(fragment, 0, AT_FILE_SIZE);
        }),
      // Retain rollback ownership until placement and the enclosing batch both succeed.
      accept: () => {
        prepared.commit();
        committed = true;
      },
      dispose: async () => {
        if (!committed) await prepared.rollback();
      },
    };
  }
  const object = result.object;
  if (object === null) throw new RemoteFault('invalid_arguments');
  return {
    commit: (store, placement) =>
      svgReport(source, result, store, placement, () => {
        store.getState().importSvgObject(object, 0, AT_FILE_SIZE);
      }),
    accept: () => undefined,
    dispose: () => Promise.resolve(),
  };
}

/**
 * File > Import's SVG parse (ADR-269 Amendment 2): the document import worker, which sanitises
 * first (scripts, foreignObject and external references are removed), cancelled with the request.
 */
async function parseSvgInWorker(
  svg: string | Uint8Array<ArrayBuffer>,
  source: string,
  signal: AbortSignal,
): Promise<ParseSvgResult> {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const parsing = parseSvgOffThread(blob, crypto.randomUUID(), source, { signal });
  if (parsing === null) throw new RemoteFault('unavailable');
  const result = await parsing;
  signal.throwIfAborted();
  return result;
}

function svgReport(
  source: string,
  result: ParseSvgResult,
  store: RemoteAppStore,
  placement: Placement,
  insert: () => void,
): ImportReport {
  // An apply_edits batch is one Undo step (ADR-584), so its fit notice says Undo reverts the batch.
  const undo: ImportBedFitUndo =
    store.getState().pendingUndo === null ? 'own-step' : 'remote-batch';
  const placed = insertAndPlace(store, placement, insert);
  return { ...placed, toasts: describeSvgImport(source, result, placed.outcome, undo) };
}

/**
 * Inserts at file size, then applies the requested width and top-left. Without a width, art
 * larger than the bed gets the desktop import's fit as its own Undo step, with any requested
 * position, so one Undo restores the file size and a second removes the import (ADR-125
 * Amendment 1 item 3, Amendment 2). Both steps are checked before the insert is committed;
 * inside a batch they join its one step. A requested width replaces the fitted size, so there
 * the fit only places the corner the width is measured from, as before.
 */
function insertAndPlace(store: RemoteAppStore, placement: Placement, insert: () => void): Placed {
  const before = new Set(store.getState().project.scene.objects.map((object) => object.id));
  const step = inOneUndoStep(store, () => {
    insert();
    const objects = store.getState().project.scene.objects.filter((item) => !before.has(item.id));
    if (objects.length === 0) throw new RemoteFault('invalid_arguments');
    const { bedWidth, bedHeight } = store.getState().project.device;
    const fit = fitImportedObjectsToBed(objects, bedWidth, bedHeight);
    const ids = objects.map((object) => object.id);
    if (fit !== null && placement.widthMm === undefined)
      return { ids, fit, placement: placementEdits(fit.objects, placement) };
    applyEdits(store, placementEdits(fit?.objects ?? objects, placement));
    return { ids, fit: null, placement: [] };
  });
  const ids = step.ids.filter(publicIdentifier).slice(0, 200);
  if (step.fit === null) return { ids, outcome: { kind: 'added' } };
  const fitted = step.fit.objects;
  inOneUndoStep(store, () => {
    for (const object of fitted) store.getState().setObjectTransform(object.id, object.transform);
    applyEdits(store, step.placement);
  });
  fitAllObjects(store.getState);
  return { ids, outcome: { kind: 'added', bedFit: step.fit.bedFit } };
}

function applyEdits(store: RemoteAppStore, edits: readonly SelectionTransformEdit[]): void {
  if (edits.length > 0) store.getState().applySelectionTransforms(edits);
}

/** The requested uniform width (about the top-left) and top-left, as absolute transforms. */
function placementEdits(
  objects: readonly SceneObject[],
  placement: Placement,
): readonly SelectionTransformEdit[] {
  let placed = objects;
  let edits: readonly SelectionTransformEdit[] = [];
  if (placement.widthMm !== undefined) {
    edits = widthEdits(objects, placement.widthMm);
    const byId = new Map(edits.map((edit) => [edit.id, edit.transform]));
    placed = objects.map((object) => ({
      ...object,
      transform: byId.get(object.id) ?? object.transform,
    }));
  }
  if (placement.xMm === undefined && placement.yMm === undefined) return edits;
  const box = bounds(placed);
  const dxMm = placement.xMm === undefined ? 0 : placement.xMm - box.minX;
  const dyMm = placement.yMm === undefined ? 0 : placement.yMm - box.minY;
  // The move covers every object, so it carries the width as well.
  return dxMm === 0 && dyMm === 0 ? edits : prepareTransforms(placed, { type: 'move', dxMm, dyMm });
}

function widthEdits(objects: readonly SceneObject[], widthMm: number): SelectionTransformEdit[] {
  const box = bounds(objects);
  const scale = widthMm / box.width;
  if (!(box.width > 0) || !Number.isFinite(scale) || scale <= 0)
    throw new RemoteFault('unsupported_operation');
  // Uniform import sizing also represents horizontal lines: zero height stays zero.
  const transforms = objects.map(({ id, transform }) => ({
    id,
    transform: {
      ...transform,
      x: box.minX + (transform.x - box.minX) * scale,
      y: box.minY + (transform.y - box.minY) * scale,
      scaleX: transform.scaleX * scale,
      scaleY: transform.scaleY * scale,
    },
  }));
  validateTransforms(objects, transforms);
  return transforms;
}

function bounds(objects: readonly SceneObject[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const object of objects) {
    const box = transformedBBox(object);
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

export async function addSvg(
  store: RemoteAppStore,
  args: Placement & { readonly svg: string },
  signal: AbortSignal,
  commit: Commit,
): Promise<Record<string, unknown>> {
  const prepared = await prepareSvgImport(args.svg, `Remote artwork ${shortId()}.svg`, signal);
  try {
    const receipt = commit(() => reportedReceipt(store, prepared.commit(store, args)));
    prepared.accept();
    return receipt;
  } finally {
    await prepared.dispose();
  }
}

function decode(base64: string): Uint8Array<ArrayBuffer> {
  let raw: string;
  try {
    raw = atob(base64);
  } catch {
    throw new RemoteFault('invalid_arguments');
  }
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const starts = (bytes: Uint8Array, magic: readonly number[]) =>
  magic.every((value, index) => bytes[index] === value);

export async function importFile(
  store: RemoteAppStore,
  args: Placement & {
    readonly fileName: string;
    readonly mimeType: 'image/svg+xml' | 'image/png' | 'image/jpeg' | 'application/dxf';
    readonly dataBase64: string;
  },
  signal: AbortSignal,
  commit: Commit,
): Promise<Record<string, unknown>> {
  const bytes = decode(args.dataBase64);
  if (args.mimeType === 'image/svg+xml') {
    // The file's bytes, as File > Import passes them to the worker.
    const prepared = await prepareSvgImport(bytes, args.fileName, signal);
    try {
      const receipt = commit(() => reportedReceipt(store, prepared.commit(store, args)));
      prepared.accept();
      return receipt;
    } finally {
      await prepared.dispose();
    }
  }
  if (args.mimeType === 'application/dxf') {
    const result = await parseDxfInWorker(bytes, args.fileName, signal);
    const object = result.object;
    return commit(() => {
      const placed = insertAndPlace(store, args, () => {
        store.getState().importSvgObject(object, 0, AT_FILE_SIZE);
      });
      // The parser's notes include an unrecognised $INSUNITS read as millimetres.
      const toasts = describeDxfImport(args.fileName, result, placed.outcome);
      return reportedReceipt(store, { ...placed, toasts });
    });
  }
  if (!starts(bytes, args.mimeType === 'image/png' ? PNG : JPEG))
    throw new RemoteFault('invalid_arguments');
  return importRaster(store, args, bytes, signal, commit);
}

/** File > Import's DXF parse (ADR-269 Amendment 1): the import worker, cancelled with the request. */
async function parseDxfInWorker(
  bytes: Uint8Array<ArrayBuffer>,
  source: string,
  signal: AbortSignal,
): Promise<Extract<ParseDxfResult, { kind: 'ok' }> & { readonly object: SceneObject }> {
  const parsing = parseDxfOffThread(new Blob([bytes]), crypto.randomUUID(), source, { signal });
  if (parsing === null) throw new RemoteFault('unavailable');
  const result = await parsing;
  if (result.kind === 'error' || result.object === null) throw new RemoteFault('invalid_arguments');
  // The whole result: its notes and skipped summary become the import's toasts.
  return { ...result, object: result.object };
}

async function importRaster(
  store: RemoteAppStore,
  args: Placement & { readonly fileName: string; readonly mimeType: string },
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
  commit: Commit,
): Promise<Record<string, unknown>> {
  const file = new File([bytes], args.fileName, { type: args.mimeType });
  // The image importer pushes its own toasts, the bed fit among them, as on the desktop.
  const pc = recordingPcToasts();
  let receipt: Record<string, unknown> | undefined;
  let placed: Placed | undefined;
  let failure: unknown;
  await importImageFile(
    file,
    (object) => {
      try {
        receipt = commit(() => {
          placed = insertAndPlace(store, args, () => {
            store.getState().importRasterImage(object, 0, AT_FILE_SIZE);
          });
          return importedReceipt(store, placed.ids);
        });
      } catch (error) {
        failure = error;
        // The image loader owns temporary paged assets until its callback succeeds.
        throw error;
      }
      return placed?.outcome;
    },
    pc.push,
    { signal },
  );
  if (failure !== undefined) throw failure;
  if (receipt === undefined || placed === undefined)
    throw new RemoteFault(signal.aborted ? 'cancelled' : 'invalid_arguments');
  return { ...receipt, ...importNoticeFields(pc.toasts, placed.outcome) };
}

/** Shows the import's PC toasts and returns them, with any bed fit, in the receipt. */
function reportedReceipt(store: RemoteAppStore, report: ImportReport): Record<string, unknown> {
  pushImportToasts(report.toasts);
  return {
    ...importedReceipt(store, report.ids),
    ...importNoticeFields(report.toasts, report.outcome),
  };
}
function importedReceipt(store: RemoteAppStore, ids: string[]): Record<string, unknown> {
  return { changedArtworkIds: ids, history: historyProjection(store.getState()) };
}
function shortId(): string {
  return crypto.randomUUID().slice(0, 8);
}
