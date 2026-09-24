export type DesktopCloseNotice = {
  readonly kind: 'pending' | 'failed' | 'unconfirmed';
  readonly message: string;
  /** Offers Retry: a failed Abort, or a Fire the app could not confirm off. */
  readonly retry?: boolean;
};

export type DesktopCloseReply =
  | { readonly status: 'ready'; readonly dirty: boolean }
  | { readonly status: 'cancelled' | 'approved' | 'retry' };

export interface DesktopCloseSnapshot {
  readonly active: boolean;
  /** Momentary Fire is latched on. Closing turns it off first, as it aborts a
   *  running job (controller audit electron-native-3). */
  readonly fireLatched?: boolean;
  readonly epoch: number;
  readonly dirty: boolean;
  readonly warning: string | null;
  readonly document: object;
}

interface CloseAttempt {
  readonly id: number;
  readonly wasActive: boolean;
  readonly promise: Promise<DesktopCloseReply>;
  readonly resolve: (reply: DesktopCloseReply) => void;
  preparedEpoch: number | null;
  preparedWarning: string | null;
  preparedDirty: boolean;
  preparedDocument: object | null;
  approved: boolean;
}

/** Owns application stop handoff only; a settled write is not a physical stop. */
export class DesktopCloseController {
  private attempt: CloseAttempt | null = null;
  private stopFlight: Promise<void> | null = null;
  private notice: DesktopCloseNotice | null = null;
  private shownWarning: DesktopCloseSnapshot | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly handledEvents = new WeakSet<Event>();

  constructor(
    private readonly read: () => DesktopCloseSnapshot,
    private readonly stop: () => Promise<void>,
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getNotice = (): DesktopCloseNotice | null => this.notice;

  get ownsUnload(): boolean {
    return this.attempt !== null;
  }

  prepare(id: number): Promise<DesktopCloseReply> {
    if (this.attempt !== null) return this.attempt.promise;
    let resolve: (reply: DesktopCloseReply) => void = () => undefined;
    const promise = new Promise<DesktopCloseReply>((done) => (resolve = done));
    const snapshot = this.read();
    const attempt: CloseAttempt = {
      id,
      wasActive: snapshot.active || snapshot.fireLatched === true || this.stopFlight !== null,
      promise,
      resolve,
      preparedEpoch: null,
      preparedWarning: null,
      preparedDirty: false,
      preparedDocument: null,
      approved: false,
    };
    this.attempt = attempt;
    if (attempt.wasActive) void this.stopForAttempt(attempt);
    else this.prepareResult(attempt);
    return promise;
  }

  /** Keep open cancels the close intention, not an Abort already being sent. */
  readonly keepOpen = (): void => {
    this.attempt?.resolve({ status: 'cancelled' });
    this.attempt = null;
    this.setNotice(null);
  };

  cancel(id: number): DesktopCloseReply {
    if (this.attempt?.id === id) this.keepOpen();
    return { status: 'cancelled' };
  }

  readonly retryStop = (): void => {
    if (this.attempt !== null && this.notice?.retry === true) {
      void this.stopForAttempt(this.attempt);
    }
  };

  readonly acknowledgeWarning = (displayedNotice: DesktopCloseNotice): void => {
    if (
      this.attempt !== null &&
      this.notice === displayedNotice &&
      displayedNotice.kind === 'unconfirmed'
    ) {
      this.prepareResult(this.attempt, this.shownWarning);
    }
  };

  approve(id: number): DesktopCloseReply {
    const attempt = this.attempt;
    // A late approval has no authority over the newer attempt that owns unload.
    if (attempt?.id !== id) return { status: 'retry' };
    if (!this.matchesPreparedState(attempt)) {
      this.keepOpen();
      return { status: 'retry' };
    }
    attempt.approved = true;
    return { status: 'approved' };
  }

  /** Both unload hooks see the same one-use decision for this DOM event. */
  handleBeforeUnload(event: BeforeUnloadEvent): boolean {
    if (this.handledEvents.has(event)) return true;
    if (this.attempt === null) return false;
    this.handledEvents.add(event);
    const approved = this.attempt.approved && this.matchesPreparedState(this.attempt);
    this.attempt.approved = false;
    if (!approved) {
      event.preventDefault();
      event.returnValue = '';
    }
    return true;
  }

  /** Browser fallback also joins an outstanding close stop after Keep open. */
  bestEffortStop(): void {
    const snapshot = this.read();
    if (snapshot.active || snapshot.fireLatched === true) {
      void this.requestStop().catch(() => undefined);
    }
  }

  private requestStop(): Promise<void> {
    if (this.stopFlight !== null) return this.stopFlight;
    let resolve: () => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const flight = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    this.stopFlight = flight;
    // Initiate synchronously: a browser's best-effort beforeunload path cannot
    // defer its first write to a future task on a page already being torn down.
    try {
      void this.stop().then(resolve, reject);
    } catch (error) {
      reject(error);
    }
    void flight
      .finally(() => {
        if (this.stopFlight === flight) this.stopFlight = null;
      })
      .catch(() => undefined);
    return flight;
  }

  private async stopForAttempt(attempt: CloseAttempt): Promise<void> {
    const jobActive = this.read().active;
    this.setNotice({
      kind: 'pending',
      message:
        (jobActive ? 'Sending Abort before closing. ' : 'Turning Fire off before closing. ') +
        'Keep this window available while the request finishes. ' +
        'A completed software request does not confirm the machine is physically stopped.',
    });
    try {
      await this.requestStop();
      if (this.attempt === attempt) this.prepareResult(attempt);
    } catch (error) {
      if (this.attempt !== attempt) return;
      // Without a job, only Fire was being turned off: its unconfirmed warning
      // can be acknowledged, so a link that refuses M5 cannot trap the window.
      if (!this.read().active) {
        this.prepareResult(attempt);
        return;
      }
      this.setNotice({
        kind: 'failed',
        retry: true,
        message:
          'The Abort request failed. The app is staying open. Use the physical E-stop or power ' +
          'cutoff if unsafe. ' +
          (error instanceof Error ? error.message : String(error)),
      });
    }
  }

  private prepareResult(
    attempt: CloseAttempt,
    acknowledged: DesktopCloseSnapshot | null = null,
  ): void {
    const snapshot = this.read();
    if (snapshot.active) {
      this.setNotice({
        kind: 'failed',
        retry: true,
        message: 'The job is still active in KerfDesk. Keep the app open or retry Abort.',
      });
      return;
    }
    if (
      snapshot.warning !== null &&
      (acknowledged?.warning !== snapshot.warning || acknowledged.epoch !== snapshot.epoch)
    ) {
      this.shownWarning = snapshot;
      this.setNotice({
        kind: 'unconfirmed',
        message: snapshot.warning,
        retry: snapshot.fireLatched === true,
      });
      return;
    }
    attempt.preparedEpoch = snapshot.epoch;
    attempt.preparedWarning = snapshot.warning;
    attempt.preparedDirty = snapshot.dirty;
    attempt.preparedDocument = snapshot.document;
    this.setNotice(null);
    attempt.resolve({ status: 'ready', dirty: snapshot.dirty });
  }

  private matchesPreparedState(attempt: CloseAttempt): boolean {
    const snapshot = this.read();
    return (
      attempt.preparedEpoch === snapshot.epoch &&
      !snapshot.active &&
      attempt.preparedWarning === snapshot.warning &&
      attempt.preparedDirty === snapshot.dirty &&
      attempt.preparedDocument === snapshot.document
    );
  }

  private setNotice(notice: DesktopCloseNotice | null): void {
    if (notice?.kind !== 'unconfirmed') this.shownWarning = null;
    this.notice = notice;
    for (const listener of this.listeners) listener();
  }
}
