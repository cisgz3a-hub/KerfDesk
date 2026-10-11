import { canControl, canEdit, store } from './store';
import { RemoteError, uuid, type LiveEvent, type RemoteTransport } from './transport';
import {
  TERMINAL_STATES,
  type ControlOperation,
  type Font,
  type MachineStatus,
  type Recipe,
  type Scene,
  type TextDetails,
  type Workspace,
} from './types';
import type { Box } from './scene';

const MACHINE_MIN_INTERVAL_MS = 1000;
const FALLBACK_POLL_MS = 5000;
const HEARTBEAT_MS = 150;

type Reader = {
  running: boolean;
  again: boolean;
  last: number;
  timer: ReturnType<typeof setTimeout> | null;
};
const reader = (): Reader => ({ running: false, again: false, last: 0, timer: null });

/**
 * Owns reads, live sync and every write. Writes always carry the latest revision and a fresh
 * UUID; the PC decides. A stale revision refreshes the view and asks the user to try again.
 */
export class Controller {
  private transport: RemoteTransport | null = null;
  private unsubscribe: (() => void) | null = null;
  private readers = { workspace: reader(), machine: reader() };
  private lastSeq = -1;
  private liveMode: 'socket' | 'wait' | 'poll' = 'poll';
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private waitAbort: AbortController | null = null;
  private hold: { operationId: string; timer: ReturnType<typeof setInterval> } | null = null;
  private stopped = false;
  private sceneSupported = true;
  private readonly uncertain = new WeakMap<
    object,
    { command: string; payload: Record<string, unknown> }
  >();

  start(transport: RemoteTransport): void {
    this.stop();
    this.stopped = false;
    this.transport = transport;
    this.unsubscribe = transport.subscribe((event) => this.live(event));
    this.liveMode = transport.kind === 'phone' ? 'poll' : 'wait';
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.pageHidden);
    void this.refreshAll();
    void this.loadLibraries();
    this.scheduleFallback();
    if (this.liveMode === 'wait') void this.waitLoop();
  }

  stop(): void {
    this.stopped = true;
    this.stopHold();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.waitAbort?.abort();
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('pagehide', this.pageHidden);
  }

  private get t(): RemoteTransport {
    if (this.transport === null) throw new RemoteError('unavailable');
    return this.transport;
  }

  /* ───────────── live sync ───────────── */

  private live(event: LiveEvent): void {
    if (event.type === 'socket') {
      store.set({ socket: event.open });
      this.liveMode = event.open ? 'socket' : 'poll';
      if (event.open) void this.refreshAll();
      else this.stopHold();
      this.scheduleFallback();
    } else if (event.type === 'presence') {
      store.set({ pcOnline: event.online });
    } else if (event.type === 'changed') {
      this.applyChange(event.revision, event.machineSeq);
    } else {
      const text = {
        'job.finished': 'The job finished.',
        'job.stopped': 'The job stopped. Check the machine.',
        'machine.alarm': 'The machine reported an alarm.',
      }[event.kind];
      store.toast(text, event.kind === 'job.finished' ? 'success' : 'warning');
      void this.refreshMachine(true);
    }
  }

  private applyChange(revision: string, machineSeq: number): void {
    if (revision !== store.get().workspace?.revision) void this.refreshWorkspace();
    if (machineSeq !== this.lastSeq) {
      this.lastSeq = machineSeq;
      if (store.get().scopes.includes('control') || store.get().tab === 'machine')
        void this.refreshMachine();
    }
  }

  private visibility = (): void => {
    if (document.visibilityState === 'hidden') {
      this.stopHold();
      return;
    }
    void this.refreshAll();
    if (this.liveMode === 'wait') void this.waitLoop();
  };
  private pageHidden = (): void => this.stopHold();

  /** No push channel: long-poll the relay; it answers without contacting the PC. */
  private async waitLoop(): Promise<void> {
    if (this.waitAbort !== null) return;
    const controller = new AbortController();
    this.waitAbort = controller;
    try {
      while (
        !this.stopped &&
        !controller.signal.aborted &&
        document.visibilityState === 'visible'
      ) {
        const workspace = store.get().workspace;
        const result = await this.t
          .call<{ revision: string; machineSeq: number; reason: string }>(
            'wait_for_change',
            {
              ...(workspace === null ? {} : { sinceRevision: workspace.revision }),
              ...(this.lastSeq < 0 ? {} : { sinceMachineSeq: this.lastSeq }),
              timeoutMs: 14_000,
            },
            { signal: controller.signal },
          )
          .catch(() => null);
        if (result === null) await delay(4000);
        else if (result.reason === 'unsupported') {
          this.liveMode = 'poll';
          this.scheduleFallback();
          return;
        } else this.applyChange(result.revision, result.machineSeq);
      }
    } finally {
      if (this.waitAbort === controller) this.waitAbort = null;
    }
  }

  private scheduleFallback(): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    if (this.liveMode !== 'poll' || this.stopped) return;
    this.pollTimer = setTimeout(() => {
      if (document.visibilityState === 'visible') void this.refreshAll();
      this.scheduleFallback();
    }, FALLBACK_POLL_MS);
  }

  /* ───────────── reads ───────────── */

  async refreshAll(): Promise<void> {
    await Promise.all([this.refreshWorkspace(), this.refreshMachine(true)]);
  }

  /** Coalesces overlapping refreshes: at most one in flight plus one queued. */
  private async coalesce(
    key: 'workspace' | 'machine',
    run: () => Promise<void>,
    minGap = 0,
  ): Promise<void> {
    const state = this.readers[key];
    if (state.running) {
      state.again = true;
      return;
    }
    const wait = state.last + minGap - Date.now();
    if (wait > 0) {
      if (state.timer === null)
        state.timer = setTimeout(() => {
          state.timer = null;
          void this.coalesce(key, run, minGap);
        }, wait);
      return;
    }
    state.running = true;
    try {
      await run();
    } catch (error) {
      if (error instanceof RemoteError && error.code === 'offline') store.set({ pcOnline: false });
    } finally {
      state.running = false;
      state.last = Date.now();
      if (state.again) {
        state.again = false;
        void this.coalesce(key, run, minGap);
      }
    }
  }

  refreshWorkspace(): Promise<void> {
    return this.coalesce('workspace', async () => {
      const workspace = await this.t.call<Workspace>('get_workspace');
      const current = store.get();
      const selection = current.pending > 0 ? current.selection : workspace.selection;
      store.set({ workspace, selection, pcOnline: true });
      if (workspace.permissions?.artworkSharingEnabled === false) {
        store.set({ scene: null, sceneRevision: workspace.revision });
        return;
      }
      if (current.sceneRevision === workspace.revision && current.scene !== null) return;
      await this.refreshScene(workspace.revision);
    });
  }

  private async refreshScene(revision: string): Promise<void> {
    if (!this.sceneSupported) return;
    try {
      const scene = await this.t.call<Scene>('get_workspace_scene');
      if (
        store.get().workspace?.revision !== revision &&
        scene.revision !== store.get().workspace?.revision
      )
        return;
      store.set({ scene, sceneRevision: scene.revision, preview: null });
    } catch (error) {
      // Older desktops do not have the vector scene; the canvas falls back to artwork bounds.
      if (error instanceof RemoteError && ['invalid_input', 'failed'].includes(error.code))
        this.sceneSupported = false;
      store.set({ preview: null });
    }
  }

  refreshMachine(force = false): Promise<void> {
    if (!store.get().scopes.includes('control') && store.get().tab !== 'machine' && !force)
      return Promise.resolve();
    return this.coalesce(
      'machine',
      async () => {
        const machine = await this.t.call<MachineStatus>('get_machine_status');
        store.set({ machine });
      },
      force ? 0 : MACHINE_MIN_INTERVAL_MS,
    );
  }

  private async loadLibraries(): Promise<void> {
    const [fonts, recipes] = await Promise.all([
      this.t.call<{ fonts: Font[] }>('list_fonts').catch(() => ({ fonts: [] })),
      this.t.call<{ recipes: Recipe[] }>('list_material_recipes').catch(() => ({ recipes: [] })),
    ]);
    store.set({ fonts: fonts.fonts, recipes: recipes.recipes });
  }

  async readText(artworkId: string): Promise<TextDetails> {
    return this.t.call<TextDetails>('get_text', { artworkId });
  }

  /* ───────────── writes ───────────── */

  /**
   * `retry` names a user intent (for example one drawing). After an uncertain outcome the same
   * intent re-sends the identical request, which the PC deduplicates instead of applying twice.
   */
  async write<T extends Record<string, unknown>>(
    command: string,
    args: Record<string, unknown> = {},
    options: { success?: string; retry?: object } = {},
  ): Promise<T | null> {
    const current = store.get();
    if (!canEdit(current) || current.workspace === null) {
      store.toast('Editing isn’t approved for this connection. Allow it on the PC.', 'warning');
      return null;
    }
    const earlier = options.retry === undefined ? undefined : this.uncertain.get(options.retry);
    const payload =
      earlier?.command === command
        ? earlier.payload
        : { ...args, expectedRevision: current.workspace.revision, requestId: uuid() };
    store.set((state) => ({ pending: state.pending + 1 }));
    try {
      const result = await this.t.call<T>(command, payload);
      if (options.retry !== undefined) this.uncertain.delete(options.retry);
      if (options.success !== undefined) store.toast(options.success, 'success');
      const changed = (result as { changedArtworkIds?: string[] }).changedArtworkIds;
      if (changed !== undefined && changed.length > 0) this.flash(changed);
      return result;
    } catch (error) {
      // A rejected transform snaps back; an unapplied drawing stays so the user can retry.
      store.set({ preview: null });
      const failure = error instanceof RemoteError ? error : new RemoteError('failed');
      if (options.retry !== undefined && failure.ambiguous)
        this.uncertain.set(options.retry, { command, payload });
      else if (options.retry !== undefined) this.uncertain.delete(options.retry);
      store.toast(
        failure.ambiguous && options.retry !== undefined
          ? 'The PC may have received that. Tap Apply again to check — it won’t be added twice.'
          : failure.message,
        failure.code === 'stale_revision' ? 'warning' : 'error',
      );
      return null;
    } finally {
      store.set((state) => ({ pending: state.pending - 1 }));
      void this.refreshWorkspace();
    }
  }

  flash(ids: string[]): void {
    store.set({ highlight: { ids, until: Date.now() + 1600 } });
  }

  async select(ids: string[]): Promise<void> {
    store.set({ selection: ids });
    if (canEdit(store.get())) await this.write('set_selection', { artworkIds: ids.slice(0, 200) });
  }

  move(ids: string[], dxMm: number, dyMm: number) {
    return this.write('transform_artwork', {
      artworkIds: ids,
      transform: { type: 'move', dxMm, dyMm },
    });
  }

  /** Resize keeps the dragged-against corner fixed: resize (top-left anchored) then move, as one Undo. */
  async scale(ids: string[], from: Box, to: Box): Promise<void> {
    const widthMm = Math.max(0.01, to.maxX - to.minX);
    const heightMm = Math.max(0.01, to.maxY - to.minY);
    const dxMm = to.minX - from.minX;
    const dyMm = to.minY - from.minY;
    const resize = { type: 'resize', widthMm, heightMm };
    if (this.designControl()) {
      const edits: Record<string, unknown>[] = [
        { command: 'transform_artwork', args: { artworkIds: ids, transform: resize } },
      ];
      if (Math.abs(dxMm) > 1e-6 || Math.abs(dyMm) > 1e-6)
        edits.push({
          command: 'transform_artwork',
          args: { artworkIds: ids, transform: { type: 'move', dxMm, dyMm } },
        });
      await this.write('apply_edits', { edits });
      return;
    }
    await this.write('transform_artwork', { artworkIds: ids, transform: resize });
    if (Math.abs(dxMm) > 1e-6 || Math.abs(dyMm) > 1e-6) await this.move(ids, dxMm, dyMm);
  }

  rotate(ids: string[], angleDeg: number) {
    return this.write('transform_artwork', {
      artworkIds: ids,
      transform: { type: 'rotate', angleDeg },
    });
  }

  designControl(): boolean {
    return store.get().workspace?.capabilities?.designControl === true;
  }

  /* ───────────── machine ───────────── */

  async machineAction(
    command: string,
    args: Record<string, unknown> = {},
    revision = true,
  ): Promise<ControlOperation | null> {
    const current = store.get();
    if (!canControl(current)) {
      store.toast('Machine control isn’t approved for this connection.', 'warning');
      return null;
    }
    const requestId = uuid();
    try {
      const result = await this.t.call<{ operation: ControlOperation }>(command, {
        ...args,
        requestId,
        ...(revision && current.workspace !== null
          ? { expectedRevision: current.workspace.revision }
          : {}),
      });
      store.set({ operation: result.operation });
      void this.followOperation(result.operation.operationId);
      return result.operation;
    } catch (error) {
      const failure = error instanceof RemoteError ? error : new RemoteError('failed');
      store.toast(
        failure.ambiguous
          ? 'The PC may have received that. Check the machine status before trying again.'
          : failure.message,
        'error',
      );
      if (failure.ambiguous) void this.followOperation(requestId);
      return null;
    } finally {
      void this.refreshMachine(true);
    }
  }

  /** Reads the receipt until it settles. Never re-sends the action. */
  private async followOperation(operationId: string): Promise<void> {
    for (let attempt = 0; attempt < 150 && !this.stopped; attempt += 1) {
      await delay(attempt < 5 ? 600 : 1200);
      const result = await this.t
        .call<{ operation: ControlOperation }>('get_control_operation', { operationId })
        .catch(() => null);
      if (result === null) continue;
      if (store.get().operation?.operationId === operationId || store.get().operation === null)
        store.set({ operation: result.operation });
      const state = result.operation.state;
      if (state === 'awaiting_review' && result.operation.review !== undefined) {
        store.set({ sheet: { kind: 'review' } });
        return;
      }
      if (TERMINAL_STATES.has(state)) {
        if (state === 'failed' || state === 'unknown')
          store.toast(result.operation.message ?? 'Check the machine on the PC.', 'warning');
        void this.refreshMachine(true);
        return;
      }
    }
  }

  async reviewPage(reviewId: string, offset: number): Promise<void> {
    const operationId = store.get().operation?.operationId;
    if (operationId === undefined) return;
    const result = await this.t
      .call<{
        operation: ControlOperation;
      }>('get_control_operation', { operationId, reviewPage: { reviewId, offset } })
      .catch(() => null);
    if (result !== null) store.set({ operation: result.operation });
  }

  abort(): Promise<ControlOperation | null> {
    this.stopHold();
    return this.machineAction('abort_job', {}, false);
  }

  /** Held jog: the PC stops it if these heartbeats stop (ADR-585). */
  async startHold(axis: 'x' | 'y' | 'z', direction: -1 | 1, feedMmPerMin?: number): Promise<void> {
    if (this.hold !== null || !this.t.socketOpen()) return;
    const operation = await this.machineAction('jog_hold_start', {
      axis,
      direction,
      ...(feedMmPerMin === undefined ? {} : { feedMmPerMin }),
    });
    if (operation === null) return;
    const operationId = operation.operationId;
    this.t.heartbeat(operationId);
    this.hold = {
      operationId,
      timer: setInterval(() => this.t.heartbeat(operationId), HEARTBEAT_MS),
    };
  }

  stopHold(): void {
    const hold = this.hold;
    if (hold === null) return;
    this.hold = null;
    clearInterval(hold.timer);
    this.transport?.releaseHolds();
    void this.transport
      ?.call('jog_hold_stop', { requestId: uuid(), operationId: hold.operationId })
      .catch(() => undefined)
      .finally(() => void this.refreshMachine(true));
  }

  holdActive(): boolean {
    return this.hold !== null;
  }

  async cameraSnapshot(): Promise<void> {
    try {
      const result = await this.t.call<{
        status: string;
        message?: string;
        image?: { data: string; widthPx: number; heightPx: number };
      }>('get_camera_snapshot');
      if (result.image === undefined) {
        store.toast(result.message ?? 'The camera isn’t available.', 'warning');
        return;
      }
      store.set({
        camera: {
          data: result.image.data,
          width: result.image.widthPx,
          height: result.image.heightPx,
          at: Date.now(),
        },
      });
    } catch (error) {
      store.toast(
        error instanceof RemoteError ? error.message : 'The camera isn’t available.',
        'error',
      );
    }
  }
}

export const controller = new Controller();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
