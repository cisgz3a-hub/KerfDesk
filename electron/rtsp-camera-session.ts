import { randomUUID } from 'node:crypto';

export type RtspPreviewStatus =
  | { readonly kind: 'starting' }
  | { readonly kind: 'live' }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type RtspPreviewLifecycle = {
  readonly markLive: () => void;
  readonly markFailed: (reason: string) => void;
  readonly markRejected: (reason: string) => void;
  readonly markClosed: () => void;
};

type SessionState = Exclude<RtspPreviewStatus, { readonly kind: 'unavailable' }>;

type SessionEntry = {
  readonly sourceUrl: string;
  activeConnections: number;
  state: SessionState;
  updatedAt: number;
};

const STARTING_TIMEOUT_MS = 15_000;
const TERMINAL_RETENTION_MS = 60_000;
const MAX_TRACKED_SESSIONS = 64;
const MISSING_SESSION_REASON = 'RTSP preview session is missing or expired.';
const CLOSED_SESSION_REASON = 'RTSP preview connection closed.';
const STARTING_TIMEOUT_REASON = 'RTSP preview request did not start in time.';

/** Bridge-owned lifecycle records for exact RTSP preview requests. */
export class RtspPreviewSessions {
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID,
  ) {}

  create(sourceUrl: string): string | null {
    this.prune();
    if (!this.makeRoom()) return null;
    const id = this.createId();
    const now = this.now();
    this.sessions.set(id, {
      sourceUrl,
      activeConnections: 0,
      state: { kind: 'starting' },
      updatedAt: now,
    });
    return id;
  }

  claim(id: string, sourceUrl: string): RtspPreviewLifecycle | null {
    this.prune();
    const entry = this.sessions.get(id);
    if (entry === undefined || entry.sourceUrl !== sourceUrl || entry.state.kind === 'failed') {
      return null;
    }
    entry.activeConnections += 1;
    entry.updatedAt = this.now();
    let connectionSettled = false;
    const finishConnection = (): boolean => {
      if (connectionSettled) return false;
      connectionSettled = true;
      entry.activeConnections = Math.max(0, entry.activeConnections - 1);
      return true;
    };
    return {
      markLive: () => {
        if (!connectionSettled) this.update(id, entry, { kind: 'live' });
      },
      markFailed: (reason) => {
        if (finishConnection()) this.update(id, entry, { kind: 'failed', reason });
      },
      markRejected: (reason) => {
        if (finishConnection() && entry.activeConnections === 0) {
          this.update(id, entry, { kind: 'failed', reason });
        }
      },
      markClosed: () => {
        if (finishConnection() && entry.activeConnections === 0) {
          this.update(id, entry, { kind: 'failed', reason: CLOSED_SESSION_REASON });
        }
      },
    };
  }

  status(id: string): RtspPreviewStatus {
    this.prune();
    const entry = this.sessions.get(id);
    if (entry === undefined) return { kind: 'unavailable', reason: MISSING_SESSION_REASON };
    this.expireStarting(entry);
    return entry.state;
  }

  private update(id: string, entry: SessionEntry, state: SessionState): void {
    if (this.sessions.get(id) !== entry || entry.state.kind === 'failed') return;
    entry.state = state;
    entry.updatedAt = this.now();
  }

  private expireStarting(entry: SessionEntry): void {
    if (entry.state.kind !== 'starting') return;
    if (this.now() - entry.updatedAt < STARTING_TIMEOUT_MS) return;
    entry.state = { kind: 'failed', reason: STARTING_TIMEOUT_REASON };
    entry.updatedAt = this.now();
  }

  private prune(): void {
    const now = this.now();
    for (const [id, entry] of this.sessions) {
      this.expireStarting(entry);
      if (entry.state.kind === 'failed' && now - entry.updatedAt >= TERMINAL_RETENTION_MS) {
        this.sessions.delete(id);
      }
    }
  }

  private makeRoom(): boolean {
    if (this.sessions.size < MAX_TRACKED_SESSIONS) return true;
    const disposable = [...this.sessions.entries()]
      .filter(([, entry]) => entry.state.kind === 'failed' || entry.activeConnections === 0)
      .sort((left, right) => left[1].updatedAt - right[1].updatedAt)[0];
    if (disposable === undefined) return false;
    this.sessions.delete(disposable[0]);
    return true;
  }
}
