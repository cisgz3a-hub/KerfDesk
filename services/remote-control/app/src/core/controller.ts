import { canControl, canEdit, store } from './store';
import { HeldJogController } from './held-jog';
import { readCameraSnapshot } from './camera-snapshot';
import { CoalescedReads } from './coalesced-reads';
import { SelectionSync } from './selection-sync';
import { moveArtwork, resizeArtwork } from './artwork-transforms';
import { followControlOperation } from './control-operation';
import { RemoteError, uuid, type LiveEvent, type RemoteTransport } from './transport';
import {
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

/**
 * Owns reads, live sync and every write. Writes carry a known document revision and a fresh
 * UUID; the PC decides. A stale revision refreshes the view and asks the user to try again.
 */
export class Controller {
  private transport: RemoteTransport | null = null;
  private unsubscribe: (() => void) | null = null;
  private readers = new CoalescedReads();
  private selections = this.selectionSync();
  private lastSeq = -1;
  private liveMode: 'socket' | 'wait' | 'poll' = 'poll';
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private waitAbort: AbortController | null = null;
  private readonly heldJog = new HeldJogController();
  private stopped = true;
  private generation = 0;
  private sceneSupported = true;
  private uncertain = new WeakMap<object, { command: string; payload: Record<string, unknown> }>();

  start(transport: RemoteTransport): void {
    this.stop();
    this.stopped = false;
    this.readers = new CoalescedReads();
    this.selections = this.selectionSync();
    this.transport = transport;
    this.unsubscribe = transport.subscribe((event) => this.live(event));
    this.liveMode = 'poll';
    this.lastSeq = -1;
    this.sceneSupported = true;
    store.set({ liveUpdates: false });
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.pageHidden);
    void this.refreshAll();
    void this.loadLibraries();
    this.scheduleFallback();
    if (transport.kind === 'mcp') void this.waitLoop();
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.stopHold();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.waitAbort?.abort();
    this.waitAbort = null;
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.readers.stop();
    this.selections.stop();
    this.uncertain = new WeakMap();
    this.transport = null;
    store.set({
      pending: 0,
      socket: false,
      liveUpdates: false,
      selectionSync: 'desktop',
      connectionGeneration: this.generation,
    });
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('pagehide', this.pageHidden);
  }

  /** Async work belongs to one connection, even if the same transport is restarted. */
  private current(generation: number): boolean {
    return !this.stopped && this.generation === generation;
  }

  private get t(): RemoteTransport {
    if (this.transport === null) throw new RemoteError('unavailable');
    return this.transport;
  }

  /* ───────────── live sync ───────────── */

  private live(event: LiveEvent): void {
    if (event.type === 'socket') {
      store.set({ socket: event.open });
      // An open socket alone says nothing about an older PC's change support.
      this.liveMode = 'poll';
      store.set({ liveUpdates: false });
      if (event.open) void this.refreshAll();
      else this.stopHold();
      this.scheduleFallback();
    } else if (event.type === 'presence') {
      store.set({ pcOnline: event.online });
      if (!event.online) {
        this.liveMode = 'poll';
        store.set({ liveUpdates: false });
        this.stopHold();
        this.scheduleFallback();
      }
    } else if (event.type === 'changed') {
      if (this.t.socketOpen()) {
        this.liveMode = 'socket';
        store.set({ liveUpdates: true });
        this.scheduleFallback();
      }
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
    const transport = this.t;
    const controller = new AbortController();
    this.waitAbort = controller;
    let revision = store.get().workspace?.revision;
    try {
      while (
        !this.stopped &&
        !controller.signal.aborted &&
        document.visibilityState === 'visible'
      ) {
        const result = await transport
          .call<{ revision: string; machineSeq: number; reason: string }>(
            'wait_for_change',
            {
              ...(revision === undefined ? {} : { sinceRevision: revision }),
              ...(this.lastSeq < 0 ? {} : { sinceMachineSeq: this.lastSeq }),
              timeoutMs: 14_000,
            },
            { signal: controller.signal },
          )
          .catch(() => null);
        if (this.stopped || controller.signal.aborted || this.transport !== transport) return;
        // Direct MCP desktops may advertise the tool but reject it in the renderer.
        // A failed/unsupported probe must never disable ordinary status polling.
        if (
          result === null ||
          result.reason === 'unsupported' ||
          typeof result.revision !== 'string' ||
          !Number.isSafeInteger(result.machineSeq) ||
          result.machineSeq < 0
        ) {
          this.liveMode = 'poll';
          store.set({ liveUpdates: false });
          this.scheduleFallback();
          return;
        }
        this.liveMode = 'wait';
        // A workspace read may still be in flight. Acknowledge this notification now so
        // the relay waits for a new change instead of immediately returning it again.
        revision = result.revision;
        store.set({ liveUpdates: true });
        this.scheduleFallback();
        this.applyChange(result.revision, result.machineSeq);
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

  refreshWorkspace(): Promise<void> {
    return this.readers.run('workspace', async () => {
      const generation = this.generation;
      const transport = this.t;
      const selectionVersion = this.selections.version;
      const selectionPending = this.selections.pending;
      const workspace = await transport.call<Workspace>('get_workspace');
      if (!this.current(generation)) return;
      const current = store.get();
      store.set({
        workspace,
        ...this.selections.reconcile(workspace, selectionVersion, selectionPending),
        pcOnline: true,
        ...(current.sceneRevision === workspace.revision
          ? {}
          : { scene: null, sceneRevision: null, preview: null }),
      });
      if (workspace.permissions?.artworkSharingEnabled === false) {
        store.set({ scene: null, sceneRevision: workspace.revision });
        return;
      }
      if (current.sceneRevision === workspace.revision && current.scene !== null) return;
      await this.refreshScene(transport, generation);
    });
  }

  private async refreshScene(transport: RemoteTransport, generation: number): Promise<void> {
    if (!this.sceneSupported) return;
    try {
      const scene = await transport.call<Scene>('get_workspace_scene');
      if (!this.current(generation)) return;
      if (scene.revision !== store.get().workspace?.revision) return;
      store.set({ scene, sceneRevision: scene.revision, preview: null });
    } catch (error) {
      if (!this.current(generation)) return;
      // Older desktops do not have the vector scene; the canvas falls back to artwork bounds.
      if (error instanceof RemoteError && ['invalid_input', 'failed'].includes(error.code))
        this.sceneSupported = false;
      store.set({ preview: null });
    }
  }

  refreshMachine(force = false): Promise<void> {
    if (!store.get().scopes.includes('control') && store.get().tab !== 'machine' && !force)
      return Promise.resolve();
    return this.readers.run(
      'machine',
      async () => {
        const generation = this.generation;
        const machine = await this.t.call<MachineStatus>('get_machine_status');
        if (!this.current(generation)) return;
        store.set({ machine });
      },
      force ? 0 : MACHINE_MIN_INTERVAL_MS,
    );
  }

  private async loadLibraries(): Promise<void> {
    const generation = this.generation;
    const transport = this.t;
    const [fonts, recipes] = await Promise.all([
      transport.call<{ fonts: Font[] }>('list_fonts').catch(() => ({ fonts: [] })),
      transport.call<{ recipes: Recipe[] }>('list_material_recipes').catch(() => ({ recipes: [] })),
    ]);
    if (!this.current(generation)) return;
    store.set({ fonts: fonts.fonts, recipes: recipes.recipes });
  }

  async readText(artworkId: string): Promise<TextDetails> {
    const generation = this.generation;
    const result = await this.t.call<TextDetails>('get_text', { artworkId });
    if (!this.current(generation)) throw new RemoteError('cancelled');
    return result;
  }

  /* ───────────── writes ───────────── */

  /**
   * `retry` names a user intent (for example one drawing). After an uncertain outcome the same
   * intent re-sends the identical request, which the PC deduplicates instead of applying twice.
   */
  async write<T extends Record<string, unknown>>(
    command: string,
    args: Record<string, unknown> = {},
    options: { success?: string; retry?: object; expectedRevision?: string } = {},
  ): Promise<T | null> {
    if (this.stopped) return null;
    const generation = this.generation;
    const owns = this.selections.owner(() => this.current(generation));
    if (command !== 'set_selection' && this.selections.pending) {
      if (!(await this.selections.wait()) || !owns()) return null;
    }
    const current = store.get();
    if (!canEdit(current) || current.workspace === null) {
      store.toast('Editing isn’t approved for this connection. Allow it on the PC.', 'warning');
      return null;
    }
    const earlier = options.retry === undefined ? undefined : this.uncertain.get(options.retry);
    const payload =
      earlier?.command === command
        ? earlier.payload
        : {
            ...args,
            expectedRevision:
              options.expectedRevision ?? this.selections.revision(current.workspace.revision),
            requestId: uuid(),
          };
    store.set((state) => ({ pending: state.pending + 1 }));
    try {
      const result = await this.t.call<T>(command, payload);
      if (!this.current(generation)) return null;
      if (command !== 'set_selection') this.selections.forgetRevision();
      if (options.retry !== undefined) this.uncertain.delete(options.retry);
      if (options.success !== undefined) store.toast(options.success, 'success');
      const changed = (result as { changedArtworkIds?: string[] }).changedArtworkIds;
      if (changed !== undefined && changed.length > 0) this.flash(changed);
      return result;
    } catch (error) {
      if (!this.current(generation)) return null;
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
      if (this.current(generation)) {
        store.set((state) => ({ pending: state.pending - 1 }));
        void this.refreshWorkspace();
      }
    }
  }

  flash(ids: string[]): void {
    store.set({ highlight: { ids, until: Date.now() + 1600 } });
  }

  private selectionSync(): SelectionSync {
    return new SelectionSync(
      (args, expectedRevision) => this.write('set_selection', args, { expectedRevision }),
      () => this.refreshWorkspace(),
    );
  }

  select(ids: string[]): Promise<void> {
    return this.selections.select(ids);
  }

  selectAll(): Promise<void> {
    return this.selections.all();
  }

  async move(ids: string[], dxMm: number, dyMm: number): Promise<void> {
    const generation = this.generation;
    const owns = this.selections.owner(() => this.current(generation));
    if (this.selections.pending && !(await this.selections.wait())) return;
    if (!owns()) return;
    await moveArtwork(this.write.bind(this), ids, dxMm, dyMm, this.designControl(), owns);
  }

  scale(ids: string[], from: Box, to: Box): Promise<void> {
    const generation = this.generation;
    const owns = this.selections.owner(() => this.current(generation));
    return resizeArtwork(this.write.bind(this), ids, from, to, this.designControl(), owns);
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
    if (this.stopped) return null;
    const generation = this.generation;
    const transport = this.t;
    const current = store.get();
    if (!canControl(current)) {
      store.toast('Machine control isn’t approved for this connection.', 'warning');
      return null;
    }
    const requestId = uuid();
    try {
      const result = await transport.call<{ operation: ControlOperation }>(command, {
        ...args,
        requestId,
        ...(revision && current.workspace !== null
          ? { expectedRevision: this.selections.revision(current.workspace.revision) }
          : {}),
      });
      // A cancelled held jog still needs its original receipt to release that operation.
      if (!this.current(generation)) return result.operation;
      store.set({ operation: result.operation });
      void this.followOperation(result.operation.operationId, transport, generation);
      return result.operation;
    } catch (error) {
      if (!this.current(generation)) return null;
      const failure = error instanceof RemoteError ? error : new RemoteError('failed');
      store.toast(
        failure.ambiguous
          ? 'The PC may have received that. Check the machine status before trying again.'
          : failure.message,
        'error',
      );
      if (failure.ambiguous) void this.followOperation(requestId, transport, generation);
      return null;
    } finally {
      if (this.current(generation)) void this.refreshMachine(true);
    }
  }

  private followOperation(
    operationId: string,
    transport: RemoteTransport,
    generation: number,
  ): Promise<void> {
    return followControlOperation(
      transport,
      operationId,
      () => this.current(generation),
      () => this.refreshMachine(true),
    );
  }

  async reviewPage(reviewId: string, offset: number): Promise<void> {
    if (this.stopped) return;
    const generation = this.generation;
    const operationId = store.get().operation?.operationId;
    if (operationId === undefined) return;
    const result = await this.t
      .call<{
        operation: ControlOperation;
      }>('get_control_operation', { operationId, reviewPage: { reviewId, offset } })
      .catch(() => null);
    if (
      result !== null &&
      this.current(generation) &&
      store.get().operation?.operationId === operationId
    )
      store.set({ operation: result.operation });
  }

  abort(): Promise<ControlOperation | null> {
    this.stopHold();
    return this.machineAction('abort_job', {}, false);
  }

  /** Held jog: the PC stops it if these heartbeats stop (ADR-585). */
  async startHold(axis: 'x' | 'y' | 'z', direction: -1 | 1, feedMmPerMin?: number): Promise<void> {
    if (this.stopped) return;
    await this.heldJog.start(this.t, () =>
      this.machineAction('jog_hold_start', {
        axis,
        direction,
        ...(feedMmPerMin === undefined ? {} : { feedMmPerMin }),
      }),
    );
  }

  stopHold(): void {
    this.heldJog.stop();
  }

  holdActive(): boolean {
    return this.heldJog.active();
  }

  cameraSnapshot(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const generation = this.generation;
    return readCameraSnapshot(this.t, () => this.current(generation));
  }
}

export const controller = new Controller();
