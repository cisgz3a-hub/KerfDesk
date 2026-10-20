import type { LicenceStatus } from './licensing-status.js';
import type { LicenceRecord } from './licensing-store.js';
import type { LicensingConfig } from './licensing-config.js';
import { grantRequest, type GrantCall } from './licensing-grant.js';
import { licenceRefreshDue } from './licensing-schedule.js';

export type RefreshReply =
  | { readonly kind: 'success'; readonly value: unknown; readonly nonce: string | undefined }
  | { readonly kind: 'failure'; readonly error: unknown };
export type BackgroundRefreshPlan = GrantCall & { readonly identity: string };
/** A service answer and the nonce its request sent (ADR-592 Amendment 1). */
export type GrantAnswer = { readonly value: unknown; readonly nonce: string | undefined };

/** Clock checkpoints and purchase records can change while the network waits. */
export function refreshIdentity(saved: LicenceRecord, device: string): string {
  const { lastSeenAt: _clock, payment: _payment, ...rights } = saved;
  return JSON.stringify([device, rights]);
}

/** A background reply answers the request it planned, so it brings that request's nonce. */
export async function readGrantReply(
  reply: RefreshReply | undefined,
  call: GrantCall,
  request: () => Promise<unknown>,
): Promise<GrantAnswer> {
  if (reply === undefined) return { value: await request(), nonce: call.nonce };
  if (reply.kind === 'failure') throw reply.error;
  return { value: reply.value, nonce: reply.nonce };
}

/** Only the request waits outside the runtime queue. Preparation and applying
 * the reply still serialize with every read and explicit licence action. */
export function createBackgroundLicenceRefresh(options: {
  readonly config: () => LicensingConfig;
  readonly deviceName: () => string;
  readonly load: () => Promise<{ readonly saved: LicenceRecord; readonly device: string }>;
  readonly evaluate: (saved: LicenceRecord, device: string) => LicenceStatus;
  readonly safe: (work: () => Promise<LicenceStatus>, mutation?: boolean) => Promise<LicenceStatus>;
  readonly readStatus: () => Promise<LicenceStatus>;
  readonly now: () => number;
  readonly request: (path: string, body: unknown) => Promise<unknown>;
  readonly apply: (reply: RefreshReply) => Promise<LicenceStatus>;
}): () => Promise<LicenceStatus> {
  let running: Promise<LicenceStatus> | null = null;
  const prepare = async () => {
    let pending: BackgroundRefreshPlan | null = null;
    const status = await options.safe(async () => {
      const config = options.config();
      if (config.channel !== 'commercial') return options.readStatus();
      const { saved, device } = await options.load();
      const current = options.evaluate(saved, device);
      const call = licenceRefreshDue(current, saved, options.now())
        ? grantRequest(config, {
            action: 'refresh',
            saved,
            device,
            deviceName: options.deviceName(),
          })
        : null;
      if (call !== null) pending = { ...call, identity: refreshIdentity(saved, device) };
      return current;
    });
    return { status, pending: pending as BackgroundRefreshPlan | null };
  };
  const refresh = async (): Promise<LicenceStatus> => {
    const { status, pending } = await prepare();
    if (pending === null) return status;
    // Saved rights stay in force while the request waits, so update
    // eligibility is not held off; applying the reply is the mutation.
    const reply: RefreshReply = await options.request(pending.path, pending.body).then(
      (value) => ({ kind: 'success', value, nonce: pending.nonce }),
      (error: unknown) => ({ kind: 'failure', error }),
    );
    return options.safe(async () => {
      const { saved, device } = await options.load();
      return refreshIdentity(saved, device) === pending.identity
        ? options.apply(reply)
        : options.evaluate(saved, device);
    }, true);
  };
  return () => (running ??= refresh().finally(() => (running = null)));
}
