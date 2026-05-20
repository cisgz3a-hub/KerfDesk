import { randomUUID } from 'node:crypto';

export type JobLifecycleResult =
  | { ok: true; token: string; ticketId: string; acquiredAt: number }
  | { ok: false; reason: 'job-running' | 'stale-token' | 'invalid-ticket' };

let activeJob: { token: string; ticketId: string; acquiredAt: number } | null = null;

export function acquireJobLifecycleToken(ticketId: unknown): JobLifecycleResult {
  if (activeJob !== null) {
    return { ok: false, reason: 'job-running' };
  }
  if (typeof ticketId !== 'string' || ticketId.trim().length === 0) {
    return { ok: false, reason: 'invalid-ticket' };
  }

  activeJob = {
    token: `job_${randomUUID()}`,
    ticketId,
    acquiredAt: Date.now(),
  };
  return { ok: true, ...activeJob };
}

export function releaseJobLifecycleToken(token: unknown): { ok: true } | { ok: false; reason: 'stale-token' } {
  if (activeJob === null) return { ok: true };
  if (typeof token !== 'string' || token !== activeJob.token) {
    return { ok: false, reason: 'stale-token' };
  }
  activeJob = null;
  return { ok: true };
}

export function hasActiveJobLifecycleToken(): boolean {
  return activeJob !== null;
}

export function canReleaseJobWakeLock(token: unknown): boolean {
  return activeJob === null || (typeof token === 'string' && token === activeJob.token);
}

export function resetJobLifecycleGuardForTests(): void {
  activeJob = null;
}
