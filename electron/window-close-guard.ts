import { rendererCloseReply, type RendererCloseOperation } from './renderer-close-request.js';
import type { WindowUnloadDecision } from './window-unload-decision.js';

interface CloseEvent {
  preventDefault(): void;
}

interface CloseTarget {
  on(event: 'close', listener: (event: CloseEvent) => void): unknown;
  on(event: 'closed' | 'unresponsive' | 'responsive', listener: () => void): unknown;
  close(): void;
  readonly webContents: {
    on(event: 'will-prevent-unload', listener: (event: CloseEvent) => void): unknown;
    on(event: 'render-process-gone' | 'did-finish-load', listener: () => void): unknown;
  };
}

interface CloseOptions {
  request(operation: RendererCloseOperation, requestId: number): Promise<unknown>;
  decideUnsaved(): WindowUnloadDecision;
  decideUnavailable(): WindowUnloadDecision;
  forceClose(): void;
  isQuitRequested(): boolean;
  cancelQuit(): void;
  quit(): void;
  reportFailure(error: unknown): void;
}

/** Retain the renderer until it finishes (or cancels) application stop handoff. */
export class WindowCloseGuard {
  private preparing = false;
  private allowNextClose = false;
  private awaitingUnload = false;
  private closed = false;
  private rendererUnavailable = false;
  private requestId = 0;

  constructor(
    private readonly window: CloseTarget,
    private readonly options: CloseOptions,
  ) {
    window.on('close', (event) => this.onClose(event));
    window.on('closed', () => (this.closed = true));
    window.webContents.on('will-prevent-unload', (event) => this.onPreventUnload(event));
    window.on('unresponsive', () => this.onRendererUnavailable('Renderer is unresponsive.'));
    window.on('responsive', () => (this.rendererUnavailable = false));
    window.webContents.on('render-process-gone', () => {
      this.onRendererUnavailable('Renderer exited during close preparation.');
    });
    window.webContents.on('did-finish-load', () => (this.rendererUnavailable = false));
  }

  private onClose(event: CloseEvent): void {
    if (this.allowNextClose) {
      this.allowNextClose = false;
      this.awaitingUnload = true;
      return;
    }
    event.preventDefault();
    this.begin();
  }

  private begin(): void {
    if (this.preparing || this.closed) return;
    this.preparing = true;
    const id = ++this.requestId;
    if (this.rendererUnavailable) {
      void this.unavailable(id, new Error('Renderer controls are unavailable.'));
    } else {
      void this.prepareAndClose(id);
    }
  }

  private async prepareAndClose(id: number): Promise<void> {
    try {
      const reply = rendererCloseReply(await this.options.request('prepare', id));
      if (!this.isCurrent(id)) return;
      if (reply.status !== 'ready') {
        if (reply.status !== 'cancelled') {
          await this.unavailable(id, new Error('Close preparation is unavailable.'));
          return;
        }
        await this.cancel(id);
        return;
      }
      if (reply.dirty && this.options.decideUnsaved() === 'stay') {
        await this.cancel(id);
        return;
      }
      const approval = rendererCloseReply(await this.options.request('approve', id));
      if (!this.isCurrent(id)) return;
      if (approval.status === 'retry') {
        this.preparing = false;
        this.begin();
        return;
      }
      if (approval.status !== 'approved') {
        await this.cancel(id);
        return;
      }
      this.preparing = false;
      this.allowNextClose = true;
      if (this.options.isQuitRequested()) this.options.quit();
      else this.window.close();
    } catch (error) {
      if (!this.isCurrent(id)) return;
      await this.unavailable(id, error);
    }
  }

  private async unavailable(id: number, error: unknown, ownedId = id): Promise<void> {
    if (!this.isCurrent(id)) return;
    this.options.reportFailure(error);
    if (this.options.decideUnavailable() === 'stay') {
      await this.cancel(id, ownedId);
      return;
    }
    // Only the explicit unavailable-renderer decision may bypass unload. It
    // makes no claim that Abort or saving ran in the unreachable renderer.
    const quitting = this.options.isQuitRequested();
    this.options.forceClose();
    if (quitting) this.options.quit();
  }

  private isCurrent(id: number): boolean {
    return !this.closed && id === this.requestId;
  }

  private onRendererUnavailable(message: string): void {
    if (this.rendererUnavailable) return;
    this.rendererUnavailable = true;
    const hadRequest = this.preparing || this.awaitingUnload;
    this.allowNextClose = false;
    this.awaitingUnload = false;
    this.preparing = false;
    // A crashed frame need not settle the JavaScript Promise it used to own.
    // Invalidate that continuation and make the native recovery choice usable.
    const ownedId = this.requestId;
    const id = ++this.requestId;
    if (hadRequest) {
      this.preparing = true;
      void this.unavailable(id, new Error(message), ownedId);
    }
  }

  private async cancel(id: number, ownedId = id): Promise<void> {
    if (id === this.requestId) this.requestId += 1;
    this.allowNextClose = false;
    this.awaitingUnload = false;
    this.options.cancelQuit();
    // Recovery must remain reachable even if the old frame never answers
    // cancel. Its generation was invalidated before this next async operation.
    this.preparing = false;
    try {
      if (!this.closed) await this.options.request('cancel', ownedId);
    } catch {
      // A crashed/unready renderer cannot cancel its state. Retain the window;
      // the readiness policy already reports load and renderer failures.
    }
  }

  private onPreventUnload(event: CloseEvent): void {
    // A renderer reload/navigation during a pending Abort cannot override
    // ownership with an idle Leave prompt and tear down the active handoff.
    if (this.preparing) return;
    if (this.awaitingUnload) {
      this.awaitingUnload = false;
      // A new run or another beforeunload handler invalidated approval. Keep
      // this event cancelled and begin again after Electron has retained it.
      const ownedId = this.requestId;
      const generation = ++this.requestId;
      this.preparing = true;
      void this.options.request('cancel', ownedId).then(
        () => {
          if (generation !== this.requestId) return;
          this.preparing = false;
          this.begin();
        },
        (error: unknown) => {
          if (this.isCurrent(generation)) void this.unavailable(generation, error, ownedId);
        },
      );
      return;
    }
    // Preserve the existing idle Leave/Stay prompt for renderer navigations
    // that did not originate from an ordinary native window-close request.
    if (this.options.decideUnsaved() === 'leave') event.preventDefault();
  }
}
