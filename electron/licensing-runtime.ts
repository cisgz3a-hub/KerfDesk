import type { LicensingConfig } from './licensing-config.js';
import {
  LicenceStoreUnreadableError,
  validLicenceKey,
  type LicenceCredential,
  type LicenceRecord,
  type LicensingStore,
} from './licensing-store.js';
import { record, verifyEntitlement, type LicenceClaims } from './licensing-verification.js';

import { evaluateLicence, licenceSummary, type LicenceStatus } from './licensing-status.js';
import { LicenceServiceError, licensingRequest } from './licensing-http.js';
import {
  checkoutFailureMessage,
  displayDeviceName,
  ERRORS,
  MESSAGES,
  paymentFailureMessage,
  refreshFailureMessage,
  RELEASED,
  requestFailureMessage,
  REVOKED,
} from './licensing-messages.js';
import { prepareLicenceCheckout, claimLicencePayment } from './licensing-commerce.js';
import { LicensingUpdateCache } from './licensing-update-cache.js';
export type { LicenceStatus } from './licensing-status.js';

type RuntimeOptions = {
  readonly config: LicensingConfig;
  readonly currentVersion: string;
  readonly store: LicensingStore;
  readonly deviceId: () => Promise<string>;
  readonly deviceName: string;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly openCheckout?: (url: string) => Promise<void>;
  readonly now?: () => number;
};

const EMPTY: LicenceRecord = { schemaVersion: 1, lastSeenAt: 0 };
// A background refresh picks up renewals and revocations about once a week.
const REFRESH_INTERVAL = 7 * 86_400;
export function createLicensingRuntime(options: RuntimeOptions) {
  return new LicensingService(options);
}

class LicensingService {
  private readonly config: LicensingConfig;
  // Once Pro is available in a session it stays until KerfDesk closes, unless
  // this device is deactivated. An ending trial never interrupts open work.
  private proLatched = false;
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
  ): LicenceStatus => licenceSummary(this.config, this.proLatched, state, claims, message, extras);
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
    const result = evaluateLicence(
      this.config,
      this.options.currentVersion,
      saved,
      device,
      this.now(),
      this.proLatched,
    );
    if (result.state === 'ready' && this.config.channel === 'commercial') this.proLatched = true;
    return result;
  };
  private readonly readStatus = async (): Promise<LicenceStatus> => {
    if (this.config.channel === 'free') return this.summary('ready');
    if (this.config.channel === 'invalid') return this.evaluate(EMPTY, '');
    const { saved, device } = await this.load();
    const result = this.evaluate(saved, device);
    // Remember checks at every read: an expired trial must not become valid again
    // by winding the clock back before the next launch.
    if (result.tier !== null && this.now() > saved.lastSeenAt)
      await this.write({ ...saved, lastSeenAt: this.now() }, device);
    return result;
  };
  private readonly safe = (work: () => Promise<LicenceStatus>, mutation = false) => {
    if (mutation) this.updateCache.beginMutation();
    return this.serial(async () => {
      try {
        return await work();
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
  private readonly credentialBody = (credential: LicenceCredential, deviceId: string) => {
    if (this.config.channel !== 'commercial') throw new Error('Commercial licensing unavailable');
    const claims = verifyEntitlement(credential.entitlement, this.config.entitlementKeys, deviceId);
    if (claims === null) throw new Error('Invalid saved licence');
    return {
      licenseId: claims.licenseId,
      activationId: claims.activationId,
      deviceId,
      activationToken: credential.activationToken,
    };
  };
  private readonly acquireRequest = (
    action: 'activate' | 'trial' | 'refresh',
    saved: LicenceRecord,
    device: string,
    licenseKey?: string,
  ): { readonly path: string; readonly body: unknown } | null => {
    if (action === 'refresh')
      return saved.credential === undefined
        ? null
        : {
            path: '/v1/activations/refresh',
            body: this.credentialBody(saved.credential, device),
          };
    return {
      path: action === 'trial' ? '/v1/trials/start' : '/v1/licenses/activate',
      body: {
        deviceId: device,
        deviceName: displayDeviceName(this.options.deviceName),
        ...(action === 'activate' ? { licenseKey } : {}),
      },
    };
  };
  private readonly acquire = async (
    action: 'activate' | 'trial' | 'refresh',
    licenseKey?: string,
    onAccepted?: () => void,
  ): Promise<LicenceStatus> => {
    if (this.config.channel !== 'commercial') return this.readStatus();
    const { saved, device } = await this.load();
    const current = this.evaluate(saved, device);
    const call =
      current.state === 'unavailable' || saved.pendingDeactivation !== undefined
        ? null
        : this.acquireRequest(action, saved, device, licenseKey);
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
    const next: LicenceRecord = {
      ...saved,
      schemaVersion: 1,
      // A freshly signed online grant can recover a corrected system clock.
      lastSeenAt: this.now(),
      refreshedAt: this.now(),
      credential: this.verifyGrant(value, device),
      ...(action === 'activate' && validLicenceKey(licenseKey) ? { licenseKey } : {}),
    };
    await this.write(next, device);
    this.updateCache.acceptAuthentication();
    onAccepted?.();
    return this.evaluate(next, device);
  };
  /** A refresh that the server answers definitively removes rights it no longer grants. */
  private readonly dropRevokedRights = async (
    saved: LicenceRecord,
    device: string,
    code: string,
  ): Promise<LicenceStatus> => {
    const revoked = REVOKED.has(code);
    if (!revoked && !RELEASED.has(code))
      return { ...this.evaluate(saved, device), message: refreshFailureMessage(code) };
    const { credential: _credential, licenseKey, ...rest } = saved;
    // A released seat keeps the key so the owner can activate again; a cancelled
    // licence's key is useless, so it is not kept.
    const next: LicenceRecord = {
      ...rest,
      refreshedAt: this.now(),
      ...(revoked || licenseKey === undefined ? {} : { licenseKey }),
    };
    await this.write(next, device);
    return { ...this.evaluate(next, device), message: ERRORS[code] ?? null };
  };
  private readonly verifyGrant = (value: unknown, device: string): LicenceCredential => {
    // Invalid responses must not re-arm a pending update using older cached rights.
    this.updateCache.failAuthentication();
    if (
      this.config.channel !== 'commercial' ||
      !record(value) ||
      typeof value.activationToken !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.activationToken)
    )
      throw new Error('Invalid activation');
    const claims = verifyEntitlement(value.entitlement, this.config.entitlementKeys, device);
    if (claims === null || Math.abs(claims.issuedAt - this.now()) > 300)
      throw new Error('Invalid entitlement');
    return {
      entitlement: value.entitlement as LicenceCredential['entitlement'],
      activationToken: value.activationToken,
    };
  };
  readonly status = () => this.safe(this.readStatus);
  readonly activate = (licenseKey: string) =>
    this.safe(() => {
      const key = licenseKey.trim();
      if (!validLicenceKey(key))
        return Promise.resolve(
          this.summary('activation-required', null, 'Enter a valid licence key.'),
        );
      return this.acquire('activate', key);
    }, true);
  readonly startTrial = () => this.safe(() => this.acquire('trial'), true);
  readonly refresh = () => this.safe(() => this.acquire('refresh'), true);
  /** Quietly confirms saved rights about once a week; never blocks or interrupts work. */
  readonly refreshInBackground = () =>
    this.safe(async () => {
      if (this.config.channel !== 'commercial') return this.readStatus();
      const { saved, device } = await this.load();
      const current = this.evaluate(saved, device);
      const due =
        ['ready', 'updates-expired', 'clock-error'].includes(current.state) &&
        this.now() - (saved.refreshedAt ?? 0) >= REFRESH_INTERVAL;
      return due ? this.acquire('refresh') : current;
    }, true);
  readonly deactivate = () =>
    this.safe(async () => {
      if (this.config.channel !== 'commercial') return this.readStatus();
      const { saved, device } = await this.load();
      const credential = saved.pendingDeactivation ?? saved.credential;
      if (credential === undefined) return this.evaluate(saved, device);
      const pending: LicenceRecord = {
        schemaVersion: 1,
        lastSeenAt: Math.max(saved.lastSeenAt, this.now()),
        pendingDeactivation: credential,
        ...(saved.payment === undefined ? {} : { payment: saved.payment }),
      };
      await this.write(pending, device);
      // The owner asked to sign this device out, so Pro locks now.
      this.proLatched = false;
      try {
        const result = await this.request(
          '/v1/activations/deactivate',
          this.credentialBody(credential, device),
        );
        if (!record(result) || result.deactivated !== true)
          throw new Error('Deactivation was not confirmed');
      } catch (error) {
        if (error instanceof LicenceServiceError && error.code === 'release_limit_reached') {
          // The seat stays here, so the device keeps its rights.
          await this.write(saved, device);
          return { ...this.evaluate(saved, device), message: ERRORS[error.code] ?? null };
        }
        return this.evaluate(pending, device);
      }
      const cleared: LicenceRecord = {
        schemaVersion: 1,
        lastSeenAt: pending.lastSeenAt,
        ...(saved.payment === undefined ? {} : { payment: saved.payment }),
      };
      await this.write(cleared, device);
      return {
        ...this.evaluate(cleared, device),
        message:
          'This device has been deactivated and its licence seat is free for another device.',
      };
    }, true);
  /** Clears an unreadable saved record; the server still holds this device's seat. */
  readonly resetStore = () =>
    this.safe(async () => {
      if (this.config.channel !== 'commercial') return this.readStatus();
      await this.options.store.reset();
      return { ...(await this.readStatus()), message: MESSAGES.reset };
    }, true);
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
          this.renewalIdentity(operation, saved, device),
        );
        return {
          ...this.evaluate((await this.options.store.read()) ?? saved, device),
          message: MESSAGES.checkoutOpened,
        };
      } catch (error) {
        return {
          ...this.evaluate((await this.options.store.read()) ?? saved, device),
          message: checkoutFailureMessage(error),
        };
      }
    });
  readonly claimPayment = () =>
    this.safe(async () => {
      if (this.config.channel !== 'commercial') return this.readStatus();
      const { saved, device } = await this.load();
      if (saved.payment === undefined) return this.evaluate(saved, device);
      try {
        const key = await claimLicencePayment({
          saved,
          store: this.options.store,
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
  readonly proUnlocked = (): boolean => this.config.channel === 'free' || this.proLatched;
  private readonly renewalIdentity = (operation: string, saved: LicenceRecord, device: string) =>
    operation === 'renewal' && saved.credential !== undefined
      ? this.credentialBody(saved.credential, device)
      : undefined;
}

export type LicensingRuntime = ReturnType<typeof createLicensingRuntime>;
