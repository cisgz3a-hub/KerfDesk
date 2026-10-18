import type { LicenceStatus } from './licensing-status.js';
import type { LicenceRecord } from './licensing-store.js';
import type { LicensingConfig } from './licensing-config.js';
import { grantRequest } from './licensing-grant.js';
import { licenceRefreshDue } from './licensing-schedule.js';

export type RefreshReply =
  | { readonly kind: 'success'; readonly value: unknown }
  | { readonly kind: 'failure'; readonly error: unknown };
export type BackgroundRefreshPlan = {
  readonly path: string;
  readonly body: unknown;
  readonly identity: string;
};

/** Clock checkpoints and purchase records can change while the network waits. */
export function refreshIdentity(saved: LicenceRecord, device: string): string {
  const { lastSeenAt: _clock, payment: _payment, ...rights } = saved;
  return JSON.stringify([device, rights]);
}

export async function readGrantReply(
  reply: RefreshReply | undefined,
  request: () => Promise<unknown>,
): Promise<unknown> {
  if (reply === undefined) return request();
  if (reply.kind === 'failure') throw reply.error;
  return reply.value;
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
  readonly mutation: (active: boolean) => void;
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
    options.mutation(true);
    try {
      const reply: RefreshReply = await options.request(pending.path, pending.body).then(
        (value) => ({ kind: 'success', value }),
        (error: unknown) => ({ kind: 'failure', error }),
      );
      return await options.safe(async () => {
        const { saved, device } = await options.load();
        return refreshIdentity(saved, device) === pending.identity
          ? options.apply(reply)
          : options.evaluate(saved, device);
      }, true);
    } finally {
      options.mutation(false);
    }
  };
  return () => (running ??= refresh().finally(() => (running = null)));
}
