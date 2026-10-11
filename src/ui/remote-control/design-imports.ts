import type { SceneObject } from '../../core/scene';
import { transformedBBox } from '../../core/scene/hit-test';
import { parseDxf } from '../../io/dxf';
import { parseSvg } from '../../io/svg';
import { importImageFile } from '../commands/import-image-action';
import { prepareSvgFragment } from '../import/svg-image-hydration';
import { useToastStore } from '../state/toast-store';
import { historyProjection } from './authoring-projections';
import { inOneUndoStep } from './design-operations';
import { RemoteFault } from './fault';
import { publicIdentifier } from './projections';
import { prepareTransforms } from './transforms';
import type { RemoteAppStore } from './types';

export type Placement = {
  readonly xMm?: number | undefined;
  readonly yMm?: number | undefined;
  readonly widthMm?: number | undefined;
};
/** Parsed and hydrated off the commit path; `commit` is synchronous so it can join one Undo step. */
export type PreparedImport = {
  readonly commit: (store: RemoteAppStore, placement: Placement) => string[];
  readonly dispose: () => Promise<void>;
};
type Commit = (action: () => Record<string, unknown>) => Record<string, unknown>;

export async function prepareSvgImport(
  svgText: string,
  source: string,
  signal: AbortSignal,
): Promise<PreparedImport> {
  // parseSvg sanitises first: scripts, foreignObject and external references are removed.
  const result = parseSvg({ svgText, id: crypto.randomUUID(), source });
  signal.throwIfAborted();
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
        insertAndPlace(store, placement, () => {
          store.getState().importSvgFragment(fragment, 0);
          prepared.commit();
          committed = true;
        }),
      dispose: async () => {
        if (!committed) await prepared.rollback();
      },
    };
  }
  const object = result.object;
  if (object === null) throw new RemoteFault('invalid_arguments');
  return objectImport(object);
}

function objectImport(object: SceneObject): PreparedImport {
  return {
    commit: (store, placement) =>
      insertAndPlace(store, placement, () => {
        store.getState().importSvgObject(object, 0);
      }),
    dispose: () => Promise.resolve(),
  };
}

/** Inserts, then optionally scales to width and moves to the requested top-left, as one Undo step. */
function insertAndPlace(store: RemoteAppStore, placement: Placement, insert: () => void): string[] {
  const before = new Set(store.getState().project.scene.objects.map((object) => object.id));
  let ids: string[] = [];
  inOneUndoStep(store, () => {
    insert();
    ids = store
      .getState()
      .project.scene.objects.filter((object) => !before.has(object.id))
      .map((object) => object.id);
    placeArtwork(store, ids, placement);
  });
  if (ids.length === 0) throw new RemoteFault('invalid_arguments');
  return ids.filter(publicIdentifier).slice(0, 200);
}

export function placeArtwork(store: RemoteAppStore, ids: readonly string[], placement: Placement) {
  if (ids.length === 0) return;
  if (placement.widthMm !== undefined) {
    const objects = currentObjects(store, ids);
    const box = bounds(objects);
    if (box.width > 0 && box.height > 0) {
      const heightMm = (box.height * placement.widthMm) / box.width;
      store
        .getState()
        .applySelectionTransforms(
          prepareTransforms(objects, { type: 'resize', widthMm: placement.widthMm, heightMm }),
        );
    }
  }
  if (placement.xMm === undefined && placement.yMm === undefined) return;
  const objects = currentObjects(store, ids);
  const box = bounds(objects);
  const dxMm = placement.xMm === undefined ? 0 : placement.xMm - box.minX;
  const dyMm = placement.yMm === undefined ? 0 : placement.yMm - box.minY;
  if (dxMm !== 0 || dyMm !== 0)
    store
      .getState()
      .applySelectionTransforms(prepareTransforms(objects, { type: 'move', dxMm, dyMm }));
}

function currentObjects(store: RemoteAppStore, ids: readonly string[]): SceneObject[] {
  const wanted = new Set(ids);
  return store.getState().project.scene.objects.filter((object) => wanted.has(object.id));
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
    return commit(() => importedReceipt(store, prepared.commit(store, args)));
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
function text(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new RemoteFault('invalid_arguments');
  }
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
    const prepared = await prepareSvgImport(text(bytes), args.fileName, signal);
    try {
      return commit(() => importedReceipt(store, prepared.commit(store, args)));
    } finally {
      await prepared.dispose();
    }
  }
  if (args.mimeType === 'application/dxf') {
    const result = parseDxf({
      dxfText: text(bytes),
      id: crypto.randomUUID(),
      source: args.fileName,
    });
    const object = result.kind === 'error' ? null : result.object;
    if (object === null) throw new RemoteFault('invalid_arguments');
    return commit(() => importedReceipt(store, objectImport(object).commit(store, args)));
  }
  if (!starts(bytes, args.mimeType === 'image/png' ? PNG : JPEG))
    throw new RemoteFault('invalid_arguments');
  return importRaster(store, args, bytes, signal, commit);
}

async function importRaster(
  store: RemoteAppStore,
  args: Placement & { readonly fileName: string; readonly mimeType: string },
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
  commit: Commit,
): Promise<Record<string, unknown>> {
  const file = new File([bytes], args.fileName, { type: args.mimeType });
  let receipt: Record<string, unknown> | undefined;
  let failure: unknown;
  await importImageFile(
    file,
    (object) => {
      try {
        receipt = commit(() =>
          importedReceipt(
            store,
            insertAndPlace(store, args, () => {
              store.getState().importRasterImage(object);
            }),
          ),
        );
      } catch (error) {
        failure = error;
      }
      return undefined;
    },
    useToastStore.getState().pushToast,
    { signal },
  );
  if (failure !== undefined) throw failure;
  if (receipt === undefined)
    throw new RemoteFault(signal.aborted ? 'cancelled' : 'invalid_arguments');
  return receipt;
}

function importedReceipt(store: RemoteAppStore, ids: string[]): Record<string, unknown> {
  return { changedArtworkIds: ids, history: historyProjection(store.getState()) };
}
function shortId(): string {
  return crypto.randomUUID().slice(0, 8);
}
