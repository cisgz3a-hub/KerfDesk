import { withUndoStepName } from '../state/undo-step-names';
import { historyProjection } from './authoring-projections';
import {
  applyMaterialRecipe,
  assignArtworkToOperation,
  createOperation,
  inOneUndoStep,
  updateOperationFull,
} from './design-operations';
import { prepareSvgImport, type Placement, type PreparedImport } from './design-imports';
import type { BatchItem, RemoteOperationPatchFull } from './design-validation';
import { RemoteFault } from './fault';
import { publicIdentifier, selectedIds } from './projections';
import { prepareRemoteText } from './text';
import type { RemoteAppStore, RemoteWrite } from './types';
import { applyRemoteWrite } from './writes';

type Prepared = {
  readonly text?: Awaited<ReturnType<typeof prepareRemoteText>>;
  readonly svg?: PreparedImport;
};
type ItemResult = { command: string; changedArtworkIds?: string[]; operationId?: string };
type Commit = (action: () => Record<string, unknown>) => Record<string, unknown>;
const REFERENCE = /^\$(\d{1,2})$/;

/**
 * All-or-nothing: inputs that need asynchronous work (text outlines, SVG image hydration) are
 * prepared first; every mutation then runs synchronously inside one interaction, so no local
 * edit can interleave and a failure rolls the whole batch back without an Undo entry.
 */
export async function applyEditsBatch(
  edits: readonly BatchItem[],
  store: RemoteAppStore,
  signal: AbortSignal,
  assertCurrent: () => void,
  commit: Commit,
): Promise<Record<string, unknown>> {
  const prepared: Prepared[] = [];
  try {
    for (const edit of edits) prepared.push(await prepareItem(edit, signal));
    assertCurrent();
    return commit(() => runBatch(store, edits, prepared, signal));
  } finally {
    await Promise.all(prepared.map((item) => item.svg?.dispose()));
  }
}

async function prepareItem(edit: BatchItem, signal: AbortSignal): Promise<Prepared> {
  if (edit.command === 'add_text')
    return {
      text: await prepareRemoteText(edit.args as Parameters<typeof prepareRemoteText>[0], signal),
    };
  if (edit.command === 'add_svg')
    return {
      svg: await prepareSvgImport(
        String(edit.args.svg),
        `Remote artwork ${crypto.randomUUID().slice(0, 8)}.svg`,
        signal,
      ),
    };
  return {};
}

function runBatch(
  store: RemoteAppStore,
  edits: readonly BatchItem[],
  prepared: readonly Prepared[],
  signal: AbortSignal,
): Record<string, unknown> {
  const results: ItemResult[] = [];
  withUndoStepName('Remote edits', () =>
    inOneUndoStep(store, () => {
      edits.forEach((edit, index) => {
        signal.throwIfAborted();
        const args = resolveReferences(edit.args, results);
        results.push({
          command: edit.command,
          ...runItem(store, edit.command, args, prepared[index], signal),
        });
      });
    }),
  );
  const changed = [...new Set(results.flatMap((item) => item.changedArtworkIds ?? []))];
  const operations = [...new Set(results.flatMap((item) => item.operationId ?? []))];
  return {
    changedArtworkIds: changed.filter(publicIdentifier).slice(0, 200),
    changedOperationIds: operations.filter(publicIdentifier).slice(0, 200),
    selection: selectedIds(store.getState()).filter(publicIdentifier).slice(0, 200),
    history: historyProjection(store.getState()),
    results: results.map((item) => ({
      command: item.command,
      ...(item.changedArtworkIds === undefined
        ? {}
        : { changedArtworkIds: item.changedArtworkIds.filter(publicIdentifier).slice(0, 200) }),
      ...(item.operationId === undefined ? {} : { operationId: item.operationId }),
    })),
  };
}

type ItemContext = {
  readonly store: RemoteAppStore;
  readonly args: Record<string, unknown>;
  readonly prepared: Prepared | undefined;
  readonly signal: AbortSignal;
};
type ItemRunner = (
  context: ItemContext,
  command: BatchItem['command'],
) => Omit<ItemResult, 'command'>;

const ordinary: ItemRunner = ({ store, args, signal }, command) =>
  pick(runOrdinaryWrite(store, command, args, signal));

/** One runner per batch command; the Record type keeps the list exhaustive. */
const ITEM_RUNNERS: Record<BatchItem['command'], ItemRunner> = {
  add_text: ({ store, prepared }) => {
    const object = prepared?.text;
    if (object === undefined) throw new RemoteFault('failed');
    store.getState().upsertTextObject(object, undefined, { placement: 'canvas' });
    return { changedArtworkIds: [object.id] };
  },
  add_svg: ({ store, args, prepared }) => {
    if (prepared?.svg === undefined) throw new RemoteFault('failed');
    return { changedArtworkIds: prepared.svg.commit(store, args as Placement) };
  },
  create_operation: ({ store, args }) => pick(createOperation(store, args)),
  assign_artwork_to_operation: ({ store, args }) =>
    pick(assignArtworkToOperation(store, args as { artworkIds: string[]; operationId: string })),
  apply_material_recipe: ({ store, args }) =>
    pick(applyMaterialRecipe(store, args as { operationId: string; recipeId: string })),
  update_operation: ({ store, args }) =>
    pick(
      updateOperationFull(store, String(args.operationId), args.patch as RemoteOperationPatchFull),
    ),
  set_selection: ordinary,
  arrange_artwork: ordinary,
  add_rectangle: ordinary,
  add_ellipse: ordinary,
  add_polyline: ordinary,
  transform_artwork: ordinary,
};

function runItem(
  store: RemoteAppStore,
  command: BatchItem['command'],
  args: Record<string, unknown>,
  prepared: Prepared | undefined,
  signal: AbortSignal,
): Omit<ItemResult, 'command'> {
  return ITEM_RUNNERS[command]({ store, args, prepared, signal }, command);
}

/** Existing single-edit writes commit before their first await, so they run synchronously here. */
function runOrdinaryWrite(
  store: RemoteAppStore,
  command: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Record<string, unknown> {
  let captured: Record<string, unknown> | undefined;
  const write = {
    command,
    args: { ...args, expectedRevision: 'batch', requestId: crypto.randomUUID() },
  } as unknown as RemoteWrite;
  const pending = applyRemoteWrite(
    write,
    store,
    signal,
    () => undefined,
    (action) => {
      captured = action();
      return captured;
    },
  );
  void pending.catch(() => undefined);
  if (captured === undefined) throw new RemoteFault('invalid_arguments');
  return captured;
}

function pick(value: Record<string, unknown>): Omit<ItemResult, 'command'> {
  const ids = value.changedArtworkIds;
  return {
    ...(Array.isArray(ids)
      ? { changedArtworkIds: ids.filter((id): id is string => typeof id === 'string') }
      : {}),
    ...(typeof value.operationId === 'string' ? { operationId: value.operationId } : {}),
  };
}

/** "$<n>" refers to artwork (all ids) or the operation created by edit n. */
function resolveReferences(args: Record<string, unknown>, results: readonly ItemResult[]) {
  const lookup = (value: string): ItemResult | null => {
    const match = REFERENCE.exec(value);
    if (match === null) return null;
    const result = results[Number(match[1])];
    if (result === undefined) throw new RemoteFault('invalid_arguments');
    return result;
  };
  const resolved: Record<string, unknown> = { ...args };
  for (const key of ['artworkIds'] as const) {
    const ids = args[key];
    if (Array.isArray(ids))
      resolved[key] = [
        ...new Set(
          ids.flatMap((id: unknown) => {
            const ref = typeof id === 'string' ? lookup(id) : null;
            if (ref === null) return [id];
            if (ref.changedArtworkIds === undefined) throw new RemoteFault('invalid_arguments');
            return ref.changedArtworkIds;
          }),
        ),
      ];
  }
  if (typeof args.operationId === 'string') {
    const ref = lookup(args.operationId);
    if (ref !== null) {
      if (ref.operationId === undefined) throw new RemoteFault('invalid_arguments');
      resolved.operationId = ref.operationId;
    }
  }
  return resolved;
}
