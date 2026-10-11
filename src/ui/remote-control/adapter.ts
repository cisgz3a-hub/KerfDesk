import { useStore } from '../state/store';
import { RemoteFault } from './fault';
import {
  appStatusProjection,
  redactReviewProjection,
  reviewProjection,
} from './status-projections';
import { machineProjection, recipesProjection } from './projections';
import { fontsProjection, workspaceReadProjection, textProjection } from './authoring-projections';
import { workspacePreviewProjection } from './preview-projection';
import { workspaceSceneProjection } from './scene-projection';
import { createRevisionTracker } from './revision';
import { canonicalRequest, record, validateCommand, type ValidatedCommand } from './validation';
import { cameraSnapshot } from './machine-camera';
import { applyRemoteWrite } from './writes';
import { applyDesignWrite } from './design-writes';
import { DESIGN_WRITE_COMMANDS, type DesignWrite } from './design-validation';
import { createMachineControl } from './machine-control';
import type {
  RemoteCommandResult,
  RemoteControlAdapter,
  RemoteControlOptions,
  RemoteWrite,
} from './types';

type CachedWrite = {
  readonly fingerprint: string;
  readonly result: Promise<RemoteCommandResult>;
  settled: boolean;
};
const MAX_REQUESTS = 256;

/** Renderer edit authority only. The main-process relay owns pairing and transport authorization. */
export function createRemoteControlAdapter(options: RemoteControlOptions): RemoteControlAdapter {
  const store = options.store ?? useStore;
  const tracker = createRevisionTracker(store);
  const machine = createMachineControl({ ...options, store }, tracker.current);
  const requests = new Map<string, CachedWrite>();
  const pending = new Set<AbortController>();
  let disposed = false;
  const failure = (cause: unknown): RemoteCommandResult => {
    const fault = cause instanceof RemoteFault ? cause : new RemoteFault('failed');
    return {
      ok: false,
      revision: tracker.current(),
      error: {
        code: fault.code === 'request_limit' ? 'failed' : fault.code,
        message: fault.message,
      },
    };
  };
  const context = {
    options,
    store,
    tracker,
    pending,
    isDisposed: () => disposed,
    failure,
    renewRevision: () => {
      tracker.renew();
      machine.revisionRenewed();
    },
  };
  return {
    getRevision: tracker.current,
    machineDelivery: machine.delivery,
    holdBeat: machine.holdBeat,
    holdRelease: machine.holdRelease,
    holdActive: machine.holdActive,
    execute: async (command, args, execution = {}) => {
      try {
        if (disposed) throw new RemoteFault('cancelled');
        if (command === 'get_camera_snapshot')
          return await cameraRead(args, options, execution, tracker.current);
        if (machine.handles(command)) return machine.execute(command, args, execution);
        const input = validateCommand(command, args);
        if (!isWrite(input)) return await readResult(input, context, execution.signal);
        const fingerprint = canonicalRequest(input);
        const cached = requests.get(input.args.requestId);
        if (cached !== undefined) {
          if (cached.fingerprint !== fingerprint) throw new RemoteFault('request_conflict');
          return cached.result;
        }
        renewFullRequestWindow(input, requests, context, execution.signal);
        // Reserve identity before async work; unresolved receipts are never evicted.
        const result = Promise.resolve().then(() => runWrite(input, context, execution.signal));
        requests.set(input.args.requestId, cachedWrite(fingerprint, result));
        return result;
      } catch (cause) {
        return failure(cause);
      }
    },
    dispose: () => {
      disposed = true;
      tracker.dispose();
      machine.dispose();
      for (const controller of pending) controller.abort();
      requests.clear();
    },
  };
}
type Context = {
  readonly options: RemoteControlOptions;
  readonly store: NonNullable<RemoteControlOptions['store']>;
  readonly tracker: ReturnType<typeof createRevisionTracker>;
  readonly pending: Set<AbortController>;
  readonly isDisposed: () => boolean;
  readonly failure: (cause: unknown) => RemoteCommandResult;
  readonly renewRevision: () => void;
};
type AnyWrite = RemoteWrite | DesignWrite;
/** ADR-585 camera still: a control-scope read with no ledger entry. */
async function cameraRead(
  args: unknown,
  options: RemoteControlOptions,
  execution: Parameters<RemoteControlAdapter['execute']>[2] & object,
  revision: () => string,
): Promise<RemoteCommandResult> {
  if (!record(args) || Object.keys(args).length > 0) throw new RemoteFault('invalid_arguments');
  const authority =
    execution.machineAuthority === undefined
      ? options.captureMachineAuthority?.()
      : execution.machineAuthority;
  const data = await cameraSnapshot(options, authority, execution.signal);
  return { ok: true, revision: revision(), data };
}
function cachedWrite(fingerprint: string, result: Promise<RemoteCommandResult>): CachedWrite {
  const receipt = { fingerprint, result, settled: false };
  const settled = () => {
    receipt.settled = true;
  };
  void result.then(settled, settled);
  return receipt;
}
function renewFullRequestWindow(
  write: AnyWrite,
  requests: Map<string, CachedWrite>,
  context: Context,
  signal?: AbortSignal,
): void {
  if (requests.size < MAX_REQUESTS) return;
  assertCurrent(write, context, signal);
  if ([...requests.values()].some((receipt) => !receipt.settled))
    throw new RemoteFault('request_limit');
  // A fresh namespace retires every serialized old write before forgetting receipts.
  context.renewRevision();
  requests.clear();
  throw new RemoteFault('stale_revision');
}
function isWrite(input: ValidatedCommand): input is AnyWrite {
  return 'expectedRevision' in input.args;
}
async function readResult(
  input: Exclude<ValidatedCommand, AnyWrite>,
  context: Context,
  signal?: AbortSignal,
): Promise<RemoteCommandResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted === true) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  context.pending.add(controller);
  try {
    return await cancellable(
      projectRead(input, context, controller.signal),
      controller.signal,
      () => false,
    );
  } finally {
    signal?.removeEventListener('abort', abort);
    context.pending.delete(controller);
  }
}
async function projectRead(
  input: Exclude<ValidatedCommand, AnyWrite>,
  context: Context,
  signal: AbortSignal,
): Promise<RemoteCommandResult> {
  if (context.isDisposed() || signal.aborted) throw new RemoteFault('cancelled');
  const state = context.store.getState();
  const revision = context.tracker.current();
  let data = await (async () => {
    switch (input.command) {
      case 'get_workspace':
        return workspaceReadProjection(state, context.options);
      case 'get_workspace_scene':
        return workspaceSceneProjection(state, context.options, signal);
      case 'get_workspace_preview':
        return workspacePreviewProjection(state, context.options, signal);
      case 'list_fonts':
        return fontsProjection();
      case 'get_text':
        return textProjection(state, input.args.artworkId, context.options);
      case 'get_machine':
        return machineProjection(state);
      case 'get_app_status':
        return appStatusProjection(context.options);
      case 'list_material_recipes':
        return recipesProjection(state);
      case 'review_job':
        return reviewProjection(
          context.options,
          revision,
          state.project.machine?.kind ?? 'laser',
          signal,
        );
    }
  })();
  if (context.isDisposed() || signal.aborted) throw new RemoteFault('cancelled');
  data = reprojectAfterRead(input.command, data, state, context.options);
  if (context.tracker.current() !== revision) throw new RemoteFault('stale_revision');
  return { ok: true, revision, data };
}
/**
 * Operation names can contain artwork wording. Re-project this synchronous snapshot using the
 * current sharing state after the read's async boundary.
 */
function reprojectAfterRead(
  command: Exclude<ValidatedCommand, AnyWrite>['command'],
  data: Record<string, unknown>,
  state: ReturnType<Context['store']['getState']>,
  options: RemoteControlOptions,
): Record<string, unknown> {
  if (command === 'get_workspace') return workspaceReadProjection(state, options);
  const next = command === 'review_job' ? redactReviewProjection(data, options) : data;
  if (options.canShareArtwork?.() === true) return next;
  if (command === 'get_text') throw new RemoteFault('unavailable');
  return command === 'get_workspace_preview' || command === 'get_workspace_scene'
    ? { status: 'disabled', message: 'Enable artwork sharing on the computer to show previews.' }
    : next;
}
async function runWrite(
  write: AnyWrite,
  context: Context,
  signal?: AbortSignal,
): Promise<RemoteCommandResult> {
  const controller = new AbortController();
  let committed = false;
  const assert = () => assertCurrent(write, context, controller.signal);
  const commit = (action: () => Record<string, unknown>) => {
    assert();
    committed = true;
    return action();
  };
  const abort = () => controller.abort();
  if (signal?.aborted === true) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  context.pending.add(controller);
  try {
    const work = DESIGN_WRITE_COMMANDS.has(write.command)
      ? applyDesignWrite(
          write as DesignWrite,
          context.store,
          context.options,
          controller.signal,
          assert,
          commit,
        )
      : applyRemoteWrite(write as RemoteWrite, context.store, controller.signal, assert, commit);
    const data = await cancellable(work, controller.signal, () => committed);
    return { ok: true, revision: context.tracker.current(), data };
  } catch (cause) {
    return context.failure(
      controller.signal.aborted && !committed ? new RemoteFault('cancelled') : cause,
    );
  } finally {
    signal?.removeEventListener('abort', abort);
    context.pending.delete(controller);
  }
}
function assertCurrent(write: AnyWrite, context: Context, signal?: AbortSignal): void {
  if (context.isDisposed() || signal?.aborted === true) throw new RemoteFault('cancelled');
  if (!context.options.canWrite()) throw new RemoteFault('read_only');
  if (context.options.canEdit?.() === false || context.store.getState().pendingUndo !== null)
    throw new RemoteFault('busy');
  if (write.args.expectedRevision !== context.tracker.current())
    throw new RemoteFault('stale_revision');
}
function cancellable<T>(
  work: Promise<T>,
  signal: AbortSignal,
  committed: () => boolean,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      if (!committed()) reject(new RemoteFault('cancelled'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
