// Dimension and layer changes need complete snapshots, while ordinary edits keep
// using tile snapshots. The WeakMap releases documents with evicted entries
// without adding UI session types or callbacks to the core history model.
import { cloneRgbaBuffer, type EditHistory } from '../../core/image-edit';
import type { EditorLayer } from '../../core/image-layers';
import type { EditorSession } from './editor-session';

type HistoryEntry = EditHistory['undoStack'][number];

type DocumentSnapshot = Pick<
  EditorSession,
  | 'base'
  | 'baseLayers'
  | 'baseActiveLayerId'
  | 'cropOffset'
  | 'pixelSizeMm'
  | 'selection'
  | 'activeLayerId'
> & {
  readonly layers: readonly EditorLayer[];
};

const documents = new WeakMap<HistoryEntry, DocumentSnapshot>();

export function captureDocumentHistory(session: EditorSession, label: string): HistoryEntry {
  const layers = session.layers.map((layer) => ({
    ...layer,
    buffer: cloneRgbaBuffer(layer.buffer),
  }));
  const base = cloneRgbaBuffer(session.base);
  const baseLayers = session.baseLayers?.map((layer) => ({
    ...layer,
    buffer: cloneRgbaBuffer(layer.buffer),
  }));
  const selection =
    session.selection === null
      ? null
      : { ...session.selection, alpha: session.selection.alpha.slice() };
  const byteSize =
    layers.reduce((bytes, layer) => bytes + layer.buffer.data.byteLength, base.data.byteLength) +
    (selection?.alpha.byteLength ?? 0) +
    (baseLayers?.reduce((bytes, layer) => bytes + layer.buffer.data.byteLength, 0) ?? 0);
  const entry: HistoryEntry = { label, scope: '', tiles: [], byteSize };
  documents.set(entry, {
    layers,
    base,
    ...(baseLayers === undefined ? {} : { baseLayers }),
    ...(session.baseActiveLayerId === undefined
      ? {}
      : { baseActiveLayerId: session.baseActiveLayerId }),
    selection,
    activeLayerId: session.activeLayerId,
    cropOffset: { ...session.cropOffset },
    pixelSizeMm: { ...session.pixelSizeMm },
  });
  return entry;
}

/** Null means this is an ordinary tile step, which the core should replay. */
export function stepDocumentHistory(
  session: EditorSession,
  from: 'undoStack' | 'redoStack',
): EditorSession | null {
  const entry = session.history[from].at(-1);
  const snapshot = entry === undefined ? undefined : documents.get(entry);
  if (entry === undefined || snapshot === undefined) return null;
  const counterpart = captureDocumentHistory(session, entry.label);
  const to = from === 'undoStack' ? 'redoStack' : 'undoStack';
  const history = fitBudget(
    {
      ...session.history,
      [from]: session.history[from].slice(0, -1),
      [to]: [...session.history[to], counterpart],
    },
    to,
  );
  const layers = snapshot.layers.map((layer) => ({
    ...layer,
    buffer: cloneRgbaBuffer(layer.buffer),
  }));
  const active = layers.find((layer) => layer.id === snapshot.activeLayerId) ?? layers[0];
  if (active === undefined) return session;
  return {
    ...session,
    layers,
    activeLayerId: active.id,
    doc: active.buffer,
    base: cloneRgbaBuffer(snapshot.base),
    ...(snapshot.baseLayers === undefined
      ? {}
      : {
          baseLayers: snapshot.baseLayers.map((layer) => ({
            ...layer,
            buffer: cloneRgbaBuffer(layer.buffer),
          })),
        }),
    ...(snapshot.baseActiveLayerId === undefined
      ? {}
      : { baseActiveLayerId: snapshot.baseActiveLayerId }),
    cropOffset: { ...snapshot.cropOffset },
    pixelSizeMm: { ...snapshot.pixelSizeMm },
    selection:
      snapshot.selection === null
        ? null
        : { ...snapshot.selection, alpha: snapshot.selection.alpha.slice() },
    history,
    revision: session.revision + 1,
    dirtySinceApply: true,
    lastDirtyRect: null,
  };
}

// Resizing can make the inverse snapshot much larger. Budget both stacks on
// traversal too, retaining the newest inverse even when it alone exceeds the
// budget, matching the core's always-allow-one-Undo contract.
function fitBudget(history: EditHistory, protectedStack: 'undoStack' | 'redoStack'): EditHistory {
  const undoStack = [...history.undoStack];
  const redoStack = [...history.redoStack];
  let bytes = [...undoStack, ...redoStack].reduce((sum, entry) => sum + entry.byteSize, 0);
  let trimmedCount = history.trimmedCount;
  while (bytes > history.byteBudget && undoStack.length + redoStack.length > 1) {
    const source =
      undoStack.length > (protectedStack === 'undoStack' ? 1 : 0) ? undoStack : redoStack;
    const removed = source.shift();
    if (removed === undefined) break;
    bytes -= removed.byteSize;
    trimmedCount += 1;
  }
  return { ...history, undoStack, redoStack, trimmedCount };
}
