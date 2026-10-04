import { rendererCloseReply, type RendererCloseOperation } from './renderer-close-request.js';
import type { UnsavedCloseDecision, WindowUnloadDecision } from './window-unload-decision.js';

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
  isApprovalCurrent?(requestId: number): boolean;
  decideUnsaved(): WindowUnloadDecision;
  /** Closing with unsaved changes (ADR-549); decideUnsaved answers without it. */
  decideUnsavedClose?(): UnsavedCloseDecision;
  decideUnavailable(): WindowUnloadDecision;
  forceClose(): void;
  isQuitRequested(): boolean;
  isUpdateCloseRequested?(): boolean;
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
  private approvedClose = false;
  private updateClose = false;

  constructor(
    private readonly window: CloseTarget,
    private readonly options: CloseOptions,
  ) {
    window.on('close', (event) => this.onClose(event));
    window.on('closed', () => {
      this.approvedClose = this.approvedClose && this.awaitingUnload && !this.rendererUnavailable;
      this.closed = true;
    });
    window.webContents.on('will-prevent-unload', (event) => this.onPreventUnload(event));
    window.on('unresponsive', () => this.onRendererUnavailable('Renderer is unresponsive.'));
    window.on('responsive', () => (this.rendererUnavailable = false));
    window.webContents.on('render-process-gone', () => {
      this.onRendererUnavailable('Renderer exited during close preparation.');
    });
    window.webContents.on('did-finish-load', () => {
      this.rendererUnavailable = false;
      this.approvedClose = false;
    });
  }

  /** True while a close attempt owns the window (ADR-482 crash recovery defers to it). */
  isClosing(): boolean {
    return this.preparing || this.awaitingUnload;
  }

  /** Installation authority is granted only after this approved window actually closed. */
  wasClosedWithApproval(): boolean {
    return this.closed && this.approvedClose;
  }

  private onClose(event: CloseEvent): void {
    if (this.allowNextClose) {
      this.allowNextClose = false;
      // A main-process admission can settle after async approval, including
      // during app.quit listeners. Recheck in the final synchronous close event.
      if (this.options.isApprovalCurrent?.(this.requestId) === false) {
        event.preventDefault();
        this.begin();
        return;
      }
      this.awaitingUnload = true;
      this.approvedClose = true;
      return;
    }
    event.preventDefault();
    this.begin();
  }

  private begin(): void {
    this.approvedClose = false;
    if (this.preparing || this.closed) return;
    this.preparing = true;
    this.updateClose = this.options.isUpdateCloseRequested?.() === true;
    const id = ++this.requestId;
    if (this.rendererUnavailable) {
      void this.unavailable(id, new Error('Renderer controls are unavailable.'));
    } else {
      void this.prepareAndClose(id);
    }
  }

  private async prepareAndClose(id: number): Promise<void> {
    try {
      const reply = rendererCloseReply(await this.options.request(this.preparationOperation(), id));
      if (!this.isCurrent(id)) return;
      if (reply.status !== 'ready') {
        if (reply.status !== 'cancelled') {
          await this.unavailable(id, new Error('Close preparation is unavailable.'));
          return;
        }
        await this.cancel(id);
        return;
      }
      if (reply.dirty && !(await this.continueWithUnsaved(id))) return;
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

  private preparationOperation(): RendererCloseOperation {
    return this.updateClose ? 'prepare-update' : 'prepare';
  }

  /**
   * Save, Don't Save or Cancel for unsaved changes (ADR-549). Resolves true
   * when the close goes on; otherwise the close has ended here. A save changes
   * the document, so the approval that follows answers retry and the close is
   * prepared again with the saved project.
   */
  private async continueWithUnsaved(id: number): Promise<boolean> {
    const decision = this.options.decideUnsavedClose?.() ?? this.options.decideUnsaved();
    const goOn =
      decision === 'save'
        ? rendererCloseReply(await this.options.request('save', id)).status === 'saved'
        : decision === 'leave';
    if (!this.isCurrent(id)) return false;
    if (!goOn) await this.cancel(id);
    return goOn;
  }

  private async unavailable(id: number, error: unknown, ownedId = id): Promise<void> {
    this.approvedClose = false;
    if (!this.isCurrent(id)) return;
    this.options.reportFailure(error);
    // Update consent never authorises force-close recovery or stopping a machine.
    if (this.updateClose) {
      await this.cancel(id, ownedId);
      return;
    }
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
    this.approvedClose = false;
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
    this.approvedClose = false;
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
    this.approvedClose = false;
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
