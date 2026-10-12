import type { LicensingConfig } from './licensing-config.js';
import {
  LicenceStoreUnreadableError,
  validLicenceKey,
  type LicenceRecord,
  type LicensingStore,
} from './licensing-store.js';
import type { LicenceClaims } from './licensing-verification.js';

import { evaluateLicence, licenceSummary, type LicenceStatus } from './licensing-status.js';
import { LicenceServiceError, licensingRequest } from './licensing-http.js';
import {
  checkoutFailureMessage,
  errorMessage,
  MESSAGES,
  paymentFailureMessage,
  refreshFailureMessage,
  requestFailureMessage,
  staleOrderMessage,
} from './licensing-messages.js';
import {
  prepareLicenceCheckout,
  claimLicencePayment,
  dropUnpayable,
  openPurchasePage,
} from './licensing-commerce.js';
import { LicensingUpdateCache } from './licensing-update-cache.js';
import { findLicenceKey } from '../public/licence-key-text.mjs';
import { manageLicenceDevices, type DeviceInput } from './licensing-devices.js';
import { saveTrialClock, TrialSessionClock, withTrialBudget } from './licensing-trial-clock.js';
import { licenceRefreshDue } from './licensing-schedule.js';
import { clockErrorMessage, LicenceClockError } from './licensing-clock.js';
import {
  activationBody,
  grantedRecord,
  grantRequest,
  renewalIdentity,
  revokedRecord,
  verifyGrant,
  withoutRejectedEntitlement,
  type GrantAction,
  type VerifiedGrant,
} from './licensing-grant.js';
import {
  deactivateDevice,
  resetSavedLicence,
  type DeactivationAccess,
} from './licensing-signout.js';
export type { LicenceStatus } from './licensing-status.js';

type RuntimeOptions = {
  readonly config: LicensingConfig;
  readonly currentVersion: string;
  readonly store: LicensingStore;
  readonly deviceId: () => Promise<string>;
  /** Read only when starting a trial; null when this computer has no usable one. */
  readonly hardwareId?: () => Promise<string | null>;
  readonly deviceName: string;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly openCheckout?: (url: string) => Promise<void>;
  readonly openPurchasePage?: (url: string) => Promise<void>;
  readonly now?: () => number;
};

const EMPTY: LicenceRecord = { schemaVersion: 1, lastSeenAt: 0 };
export function createLicensingRuntime(options: RuntimeOptions) {
  return new LicensingService(options);
}

class LicensingService {
  private readonly config: LicensingConfig;
  // Paid rights retain their session allowance. A trial's deadline applies to
  // new Pro choices even while open; existing work/output never reads this gate.
  private proLatched = false;
  // A definitive refusal remains binding in this process even if removing the
  // saved record fails. Only a newly accepted online grant may restore it.
  private rejectedEntitlement: string | null = null;
  private trialClock: TrialSessionClock | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly updateCache: LicensingUpdateCache;

  constructor(private readonly options: RuntimeOptions) {
    this.config = options.config;
    this.updateCache = new LicensingUpdateCache(options.config, () => this.now());
  }
  private readonly now = (): number => Math.floor((this.options.now?.() ?? Date.now()) / 1000);
  private readonly summary = (
    state: LicenceStatus['state'],
    claims: LicenceClaims | null = null,
    message: string | null = null,
    extras: Parameters<typeof licenceSummary>[5] = {},
  ): LicenceStatus => {
    // An error without verified trial claims must not turn bounded access into
    // an unbounded Pro status in the renderer. Paid session rights are unchanged.
    if (this.trialClock !== null) this.proLatched = false;
    return licenceSummary(this.config, this.proUnlocked(), state, claims, message, extras);
  };
  private readonly trialNow = (): number => this.trialClock?.now() ?? this.now();
  private readonly serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  };
  private readonly load = async () => {
    try {
      const loaded = {
        saved: (await this.options.store.read()) ?? EMPTY,
        device: await this.options.deviceId(),
      };
      this.updateCache.update(loaded.saved, loaded.device);
      return loaded;
    } catch (error) {
      this.updateCache.invalidate();
      throw error;
    }
  };
  private readonly write = async (saved: LicenceRecord, device: string): Promise<void> => {
    this.updateCache.invalidate();
    await this.options.store.write(saved);
    this.updateCache.update(saved, device);
  };
  private readonly evaluate = (saved: LicenceRecord, device: string): LicenceStatus => {
    saved = withoutRejectedEntitlement(saved, this.rejectedEntitlement);
    const clock = this.trialClock;
    const ended = clock !== null && this.trialNow() >= clock.expiresAt;
    const result = evaluateLicence(
      this.config,
      this.options.currentVersion,
      saved,
      device,
      ended ? Math.max(this.now(), clock.expiresAt) : this.now(),
      clock === null && this.proUnlocked(),
    );
    // An observed expiry stays ended even if its disk checkpoint cannot be saved.
    if (result.accessExpiresAt !== null && clock?.expiresAt !== result.accessExpiresAt)
      this.trialClock = new TrialSessionClock(result.accessExpiresAt, this.now, saved.lastSeenAt);
    if (result.state === 'ready' && this.config.channel === 'commercial') {
      this.proLatched = true;
      if (result.tier !== 'trial') this.trialClock = null;
    } else if (this.trialClock !== null || result.tier === 'trial') this.proLatched = false;
    return withTrialBudget(result, saved.lastSeenAt, this.trialNow);
  };
  private readonly readStatus = async (): Promise<LicenceStatus> => {
    if (this.config.channel === 'free') return this.summary('ready');
    if (this.config.channel === 'invalid') return this.evaluate(EMPTY, '');
    const { saved, device } = await this.load();
    return this.evaluate(saved, device);
  };
  private readonly safe = (
    work: () => Promise<LicenceStatus>,
    mutation: boolean | 'activation' = false,
  ) => {
    if (mutation) this.updateCache.beginMutation();
    return this.serial(async () => {
      try {
        const result = await work();
        // Every verified trial status, including order/reset actions, saves observed time.
        if (result.tier === 'trial') {
          const { saved, device } = await this.load();
          return await saveTrialClock(
            result,
            saved,
            this.trialNow(),
            (next) => this.write(next, device),
            mutation === 'activation' ? () => this.evaluate(saved, device) : undefined,
          );
        }
        return result;
      } catch (error) {
        this.updateCache.invalidate();
        if (error instanceof LicenceStoreUnreadableError)
          return this.summary('invalid-licence', null, MESSAGES.unreadable, {
            storeUnreadable: true,
          });
        return this.summary('unavailable', null, MESSAGES.unavailable);
      } finally {
        if (mutation) this.updateCache.endMutation();
      }
    });
  };
  private readonly request = (path: string, body: unknown): Promise<unknown> => {
    if (this.config.channel !== 'commercial') throw new Error('Commercial licensing unavailable');
    return licensingRequest(this.config.apiOrigin, this.options.fetch)(path, body);
  };
  private readonly acquire = async (
    action: GrantAction,
    licenseKey?: string,
    onAccepted?: () => void,
  ): Promise<LicenceStatus> => {
    if (this.config.channel !== 'commercial') return this.readStatus();
    const { saved, device } = await this.load();
    const current = this.evaluate(saved, device);
    if (current.state === 'unavailable') return current;
    // A pending deactivation no longer blocks an explicit activation or trial;
    // the new grant replaces it (ADR-523 Amendment 2).
    const call = grantRequest(this.config, {
      action,
      saved,
      device,
      deviceName: this.options.deviceName,
      licenseKey,
      hardwareId: action === 'trial' ? await this.options.hardwareId?.() : undefined,
    });
    if (call === null) return current;
    let value: unknown;
    try {
      value = await this.request(call.path, call.body);
    } catch (error) {
      this.updateCache.failAuthentication();
      if (action === 'refresh' && error instanceof LicenceServiceError)
        return this.dropRevokedRights(saved, device, error.code);
      return { ...this.evaluate(saved, device), message: requestFailureMessage(error) };
    }
    try {
      return await this.acceptGrant(action, value, { saved, device }, licenseKey, onAccepted);
    } catch (error) {
      if (action !== 'activate' || current.tier !== 'trial') throw error;
      // A rejected or unsaved paid grant cannot replace an existing trial.
      // Re-evaluate its signed deadline; never extend it while the request waits.
      return { ...this.evaluate(saved, device), message: MESSAGES.unavailable };
    }
  };
  private readonly acceptGrant = async (
    action: GrantAction,
    value: unknown,
    { saved, device }: { readonly saved: LicenceRecord; readonly device: string },
    licenseKey?: string,
    onAccepted?: () => void,
  ): Promise<LicenceStatus> => {
    // Invalid responses must not re-arm a pending update using older cached rights.
    this.updateCache.failAuthentication();
    let grant: VerifiedGrant;
    try {
      grant = verifyGrant(this.config, value, device, this.now());
    } catch (error) {
      if (!(error instanceof LicenceClockError)) throw error;
      // The service answered, but this computer's clock is too far off to trust it.
      const kept = this.evaluate(saved, device);
      return { ...kept, state: 'clock-error', message: clockErrorMessage(error.offset) };
    }
    const { next, droppedOrder } = grantedRecord(action, saved, grant, this.now(), licenseKey);
    await this.write(next, device);
    // Only a newly verified online grant can re-anchor a clock that was wrong;
    // rereading cached rights must not revive an already observed trial expiry.
    this.trialClock = null;
    this.proLatched = false;
    this.rejectedEntitlement = null;
    this.updateCache.acceptAuthentication();
    onAccepted?.();
    const status = this.evaluate(next, device);
    if (droppedOrder === null) return status;
    return { ...status, message: staleOrderMessage(droppedOrder.order?.orderId ?? null) };
  };
  /** A refresh that the server answers definitively removes rights it no longer grants. */
  private readonly dropRevokedRights = async (
    saved: LicenceRecord,
    device: string,
    code: string,
  ): Promise<LicenceStatus> => {
    const next = revokedRecord(saved, code, this.now());
    if (next === null)
      return { ...this.evaluate(saved, device), message: refreshFailureMessage(code) };
    // The paid session allowance covers offline/overdue checks, never rights
    // the service has explicitly revoked or released. Existing jobs and output
    // do not read this Pro-tool gate (ADR-592).
    this.proLatched = false;
    this.trialClock = null;
    this.rejectedEntitlement = saved.credential?.entitlement.payload ?? null;
    await this.write(next, device);
    return { ...this.evaluate(next, device), message: errorMessage(code) };
  };
  /** What deactivation and reset use of this runtime (licensing-signout.ts). */
  private readonly access = (): DeactivationAccess => ({
    load: this.load,
    write: this.write,
    evaluate: this.evaluate,
    status: this.readStatus,
    now: this.now,
    request: this.request,
    credentialBody: (credential, device) => activationBody(this.config, credential, device),
    lockPro: () => {
      this.proLatched = false;
    },
  });
  readonly status = () => this.safe(this.readStatus);
  readonly activate = (licenseKey: string) =>
    this.safe(async () => {
      // Accept the key inside whatever was pasted; anything else keeps the plain rule
      // and the service decides. The form, not this, warns about a partial key.
      const key = findLicenceKey(licenseKey) ?? licenseKey.trim();
      if (!validLicenceKey(key))
        return { ...(await this.readStatus()), message: MESSAGES.invalidKey };
      return this.acquire('activate', key);
    }, 'activation');
  readonly startTrial = () => this.safe(() => this.acquire('trial'), true);
  readonly refresh = () => this.safe(() => this.acquire('refresh'), true);
  /**
   * Quietly confirms saved rights about once a week, and otherwise moves a
   * trial's clock mark on. Runs at launch and every 30 minutes while KerfDesk is
   * open; it never blocks or interrupts work.
   */
  readonly refreshInBackground = () =>
    this.safe(async () => {
      if (this.config.channel !== 'commercial') return this.readStatus();
      const { saved, device } = await this.load();
      const current = this.evaluate(saved, device);
      if (licenceRefreshDue(current, saved.refreshedAt, this.now())) return this.acquire('refresh');
      return current;
    }, true);
  readonly deactivate = () =>
    this.safe(async () => {
      if (this.config.channel !== 'commercial') return this.readStatus();
      return deactivateDevice(this.access());
    }, true);
  /** Clears what blocks this device: an unreadable record or a stuck deactivation. */
  readonly resetStore = () =>
    this.safe(async () => {
      if (this.config.channel !== 'commercial') return this.readStatus();
      return resetSavedLicence(this.access(), this.options.store);
    }, true);
  /** Buy Pro: the purchase page itself, in the browser; nothing is saved here. */
  readonly openPurchasePage = () =>
    this.safe(async () => openPurchasePage(this.options, this.config, await this.readStatus()));
  readonly checkout = (operation: 'purchase' | 'renewal', licenseKey?: string) =>
    this.safe(async () => {
      if (this.config.channel !== 'commercial') return this.readStatus();
      const { saved, device } = await this.load();
      const current = this.evaluate(saved, device);
      if (
        current.state === 'unavailable' ||
        current.deactivationPending ||
        current.tier === 'developer'
      )
        return current;
      try {
        await prepareLicenceCheckout(
          {
            saved,
            store: this.options.store,
            sandbox: this.config.sandbox === true,
            request: this.request,
            openCheckout:
              this.options.openCheckout ??
              (async () => {
                throw new Error('Checkout unavailable');
              }),
          },
          operation,
          licenseKey,
          true,
          renewalIdentity(this.config, operation, saved, device),
        );
        return {
          ...this.evaluate((await this.options.store.read()) ?? saved, device),
          message: MESSAGES.checkoutOpened,
        };
      } catch (error) {
        const stored = (await this.options.store.read()) ?? saved;
        const forgotten = dropUnpayable(stored, error, saved);
        if (forgotten !== stored) await this.write(forgotten, device);
        return { ...this.evaluate(forgotten, device), message: checkoutFailureMessage(error) };
      }
    }, true);
  readonly claimPayment = () =>
    this.safe(async () => {
      if (this.config.channel !== 'commercial') return this.readStatus();
      const { saved, device } = await this.load();
      if (saved.payment === undefined) return this.evaluate(saved, device);
      try {
        const key = await claimLicencePayment({
          saved,
          store: this.options.store,
          sandbox: this.config.sandbox === true,
          request: this.request,
          openCheckout: this.options.openCheckout ?? (async () => undefined),
        });
        if (key === null) return this.evaluate(saved, device);
        let accepted = false;
        const activated = await this.acquire('activate', key, () => {
          accepted = true;
        });
        if (!accepted) return activated;
        const stored = await this.options.store.read();
        if (stored === null) throw new Error('Licence was not saved');
        const { payment: _payment, ...withoutPayment } = stored;
        await this.write(withoutPayment, device);
        return { ...this.evaluate(withoutPayment, device), message: MESSAGES.paid };
      } catch (error) {
        return {
          ...this.evaluate((await this.options.store.read()) ?? saved, device),
          message: paymentFailureMessage(error),
        };
      }
    }, true);
  /**
   * Forgets a saved order so a new checkout can start. The server keeps the
   * order: if it was in fact paid, support can still find its licence.
   */
  readonly discardPayment = () =>
    this.safe(async () => {
      if (this.config.channel !== 'commercial') return this.readStatus();
      const { saved, device } = await this.load();
      if (saved.payment === undefined) return this.evaluate(saved, device);
      const { payment: _payment, ...withoutPayment } = saved;
      await this.write(withoutPayment, device);
      return { ...this.evaluate(withoutPayment, device), message: MESSAGES.orderForgotten };
    }, true);
  readonly devices = (licenseKey?: string) => this.manageDevices({ licenseKey });
  readonly releaseDevice = (activationId: string, licenseKey?: string) =>
    this.manageDevices({ licenseKey, activationId });
  private readonly manageDevices = (input: DeviceInput) =>
    this.serial(() => manageLicenceDevices(this.config, this.options.store, this.request, input));
  readonly isReleaseEligible = (releaseEnvelope: unknown, expectedVersion: string) =>
    this.serial(async () => {
      if (this.config.channel !== 'commercial') return false;
      try {
        await this.load();
        return this.updateCache.eligible(releaseEnvelope, expectedVersion);
      } catch {
        return false;
      }
    });
  readonly isReleaseEligibleCached = (releaseEnvelope: unknown, expectedVersion: string): boolean =>
    this.updateCache.eligible(releaseEnvelope, expectedVersion);
  readonly isManualReleaseEligible = (envelope: string, version: string): Promise<boolean> =>
    this.serial(async () => {
      try {
        await this.load();
        return await this.updateCache.manualEligible(envelope, version);
      } catch {
        return false;
      }
    });
  readonly proUnlocked = (): boolean =>
    this.config.channel === 'commercial' &&
    this.proLatched &&
    (this.trialClock === null || this.trialNow() < this.trialClock.expiresAt);
}

export type LicensingRuntime = ReturnType<typeof createLicensingRuntime>;
