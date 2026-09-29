import { LicenceServiceError } from './licensing-http.js';
import { errorMessage, MESSAGES, RELEASED, REVOKED } from './licensing-messages.js';
import type { LicenceStatus } from './licensing-status.js';
import {
  LicenceStoreUnreadableError,
  type LicenceCredential,
  type LicenceRecord,
  type LicensingStore,
} from './licensing-store.js';
import { record } from './licensing-verification.js';

// Signing a device out of its licence, and the ways out when that gets stuck
// (ADR-523 Amendment 2). A licence change never touches a running job or any
// machine control; only the Pro tools follow it (ADR-540).

/** What the runtime lends these steps: its serial, cache-aware record access. */
export type RecordAccess = {
  readonly load: () => Promise<{ readonly saved: LicenceRecord; readonly device: string }>;
  readonly write: (saved: LicenceRecord, device: string) => Promise<void>;
  readonly evaluate: (saved: LicenceRecord, device: string) => LicenceStatus;
  readonly status: () => Promise<LicenceStatus>;
  readonly now: () => number;
};
export type DeactivationAccess = RecordAccess & {
  readonly request: (path: string, body: unknown) => Promise<unknown>;
  /** The service request for a saved credential, or null once it no longer verifies here. */
  readonly credentialBody: (credential: LicenceCredential, device: string) => unknown;
  /** Deactivating is the owner's own act, so Pro locks at once (ADR-540 item 4). */
  readonly lockPro: () => void;
};

type Outcome =
  | { readonly kind: 'retry' }
  | { readonly kind: 'kept' | 'signed-out'; readonly message: string | null };

// The service will never free this seat with this credential: it does not know
// the seat, or the licence is no longer usable.
const SEAT_UNKNOWN = new Set(['invalid_credentials', 'activation_not_found']);

export async function deactivateDevice(access: DeactivationAccess): Promise<LicenceStatus> {
  const { saved, device } = await access.load();
  const credential = saved.pendingDeactivation ?? saved.credential;
  if (credential === undefined) return access.evaluate(saved, device);
  const signedOut = signedOutRecord(saved, access.now());
  const body = access.credentialBody(credential, device);
  // A credential that no longer verifies can never free its seat, so it is not kept.
  if (body === null) return finish(access, signedOut, device, MESSAGES.seatNotFreed);
  const pending: LicenceRecord = { ...signedOut, pendingDeactivation: credential };
  await access.write(pending, device);
  access.lockPro();
  const outcome = await release(access, body);
  if (outcome.kind === 'retry') return access.evaluate(pending, device);
  // The service kept the seat here, so this computer keeps its licence too.
  if (outcome.kind === 'kept')
    return finish(access, withCredential(saved, credential), device, outcome.message);
  return finish(access, signedOut, device, outcome.message);
}

async function release(access: DeactivationAccess, body: unknown): Promise<Outcome> {
  try {
    const result = await access.request('/v1/activations/deactivate', body);
    return record(result) && result.deactivated === true
      ? { kind: 'signed-out', message: MESSAGES.deactivated }
      : { kind: 'retry' };
  } catch (error) {
    return refusal(error);
  }
}

/** Only a definite answer ends a pending deactivation; anything else is retried. */
function refusal(error: unknown): Outcome {
  if (!(error instanceof LicenceServiceError)) return { kind: 'retry' };
  const { code } = error;
  if (code === 'release_limit_reached') return { kind: 'kept', message: errorMessage(code) };
  if (RELEASED.has(code)) return { kind: 'signed-out', message: MESSAGES.deactivated };
  if (REVOKED.has(code) || code === 'license_inactive')
    return { kind: 'signed-out', message: errorMessage(code) };
  if (SEAT_UNKNOWN.has(code)) return { kind: 'signed-out', message: MESSAGES.seatNotFreed };
  return { kind: 'retry' };
}

async function finish(
  access: DeactivationAccess,
  next: LicenceRecord,
  device: string,
  message: string | null,
): Promise<LicenceStatus> {
  await access.write(next, device);
  if (next.credential === undefined) access.lockPro();
  return { ...access.evaluate(next, device), message };
}

function signedOutRecord(saved: LicenceRecord, now: number): LicenceRecord {
  return {
    schemaVersion: 1,
    lastSeenAt: Math.max(saved.lastSeenAt, now),
    ...(saved.payment === undefined ? {} : { payment: saved.payment }),
  };
}

function withCredential(saved: LicenceRecord, credential: LicenceCredential): LicenceRecord {
  const { pendingDeactivation: _pending, ...rest } = saved;
  return { ...rest, credential };
}

/**
 * Help > Licence's "Reset saved licence". An unreadable record is set aside for
 * support; a stuck deactivation is dropped, keeping any saved order; a readable
 * licence is never thrown away. The server keeps this device's seat for reuse.
 */
export async function resetSavedLicence(
  access: RecordAccess,
  store: LicensingStore,
): Promise<LicenceStatus> {
  let loaded: Awaited<ReturnType<RecordAccess['load']>>;
  try {
    loaded = await access.load();
  } catch (error) {
    if (!(error instanceof LicenceStoreUnreadableError)) throw error;
    await store.reset();
    return { ...(await access.status()), message: MESSAGES.reset };
  }
  const { saved, device } = loaded;
  if (saved.pendingDeactivation === undefined)
    return { ...access.evaluate(saved, device), message: MESSAGES.nothingToReset };
  const { pendingDeactivation: _pending, ...rest } = saved;
  await access.write(rest, device);
  return { ...access.evaluate(rest, device), message: MESSAGES.pendingCleared };
}
