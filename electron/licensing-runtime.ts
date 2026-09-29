import type { LicensingConfig } from './licensing-config.js';
import type { LicenceCredential, LicenceRecord, LicensingStore } from './licensing-store.js';
import { record, verifyEntitlement, type LicenceClaims } from './licensing-verification.js';

import { evaluateLicence, licenceSummary, type LicenceStatus } from './licensing-status.js';
import { LicenceServiceError, licensingRequest } from './licensing-http.js';
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
  readonly onSessionAuthorized?: () => void;
  readonly now?: () => number;
};

const EMPTY: LicenceRecord = { schemaVersion: 1, lastSeenAt: 0 };
const ERRORS: Readonly<Record<string, string>> = {
  device_limit: 'This licence already has three active devices. Deactivate another device first.',
  device_limit_reached:
    'This licence already has three active devices. Deactivate another device first.',
  trial_already_used:
    'The trial for this device has already started. Activate your licence to continue.',
  invalid_license: 'This licence key was not accepted. Check the key and try again.',
  license_not_found: 'This licence key was not accepted. Check the key and try again.',
  rate_limited: 'Too many attempts. Please wait and try again.',
  payment_pending: 'Payment is still pending. Complete checkout, then check payment again.',
  checkout_pending: 'Checkout is still being prepared. Please check payment again shortly.',
  payment_provider_not_configured:
    'Online checkout is not available yet. You can still activate an existing licence.',
};

export function createLicensingRuntime(options: RuntimeOptions) {
  return new LicensingService(options);
}

class LicensingService {
  private readonly config: LicensingConfig;
  private authorized: boolean;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly updateCache: LicensingUpdateCache;

  constructor(private readonly options: RuntimeOptions) {
    this.config = options.config;
    this.authorized = options.config.channel === 'free';
    this.updateCache = new LicensingUpdateCache(options.config, () => this.now());
  }
  private readonly now = (): number => Math.floor((this.options.now?.() ?? Date.now()) / 1000);
  private readonly summary = (
    state: LicenceStatus['state'],
    claims: LicenceClaims | null = null,
    pending = false,
    message: string | null = null,
  ): LicenceStatus => licenceSummary(this.config, this.authorized, state, claims, pending, message);
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
  private readonly evaluate = (saved: LicenceRecord, device: string): LicenceStatus =>
    evaluateLicence(
      this.config,
      this.options.currentVersion,
      saved,
      device,
      this.now(),
      this.authorized,
    );
  private readonly readStatus = async (): Promise<LicenceStatus> => {
    if (this.config.channel === 'free') return this.summary('ready');
    if (this.config.channel === 'invalid') return this.evaluate(EMPTY, '');
    const { saved, device } = await this.load();
    const result = this.evaluate(saved, device);
    // Remember checks at the gate too: an expired trial never reaches launch().
    if (result.tier !== null && this.now() > saved.lastSeenAt)
      await this.write({ ...saved, lastSeenAt: this.now() }, device);
    return result;
  };
  private readonly safe = (work: () => Promise<LicenceStatus>, mutation = false) => {
    if (mutation) this.updateCache.beginMutation();
    return this.serial(async () => {
      try {
        return await work();
      } catch {
        this.updateCache.invalidate();
        return this.summary(
          'unavailable',
          null,
          false,
          'The licence service or secure local storage is unavailable. Your existing session remains open. Check your connection and operating-system keychain, then try again.',
        );
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
  private readonly acquire = async (
    action: 'activate' | 'trial' | 'refresh',
    licenseKey?: string,
    onAccepted?: () => void,
  ): Promise<LicenceStatus> => {
    if (this.config.channel !== 'commercial') return this.readStatus();
    const { saved, device } = await this.load();
    if (this.evaluate(saved, device).state === 'unavailable') return this.evaluate(saved, device);
    if (saved.pendingDeactivation !== undefined) return this.evaluate(saved, device);
    let path: string;
    let body: unknown;
    if (action === 'refresh') {
      if (saved.credential === undefined) return this.evaluate(saved, device);
      path = '/v1/activations/refresh';
      body = this.credentialBody(saved.credential, device);
    } else {
      path = action === 'trial' ? '/v1/trials/start' : '/v1/licenses/activate';
      body = {
        deviceId: device,
        deviceName: displayDeviceName(this.options.deviceName),
        ...(action === 'activate' ? { licenseKey } : {}),
      };
    }
    let value: unknown;
    try {
      value = await this.request(path, body);
    } catch (error) {
      this.updateCache.failAuthentication();
      const current = this.evaluate(saved, device);
      return {
        ...current,
        message:
          error instanceof LicenceServiceError
            ? (ERRORS[error.code] ??
              'The licence service could not complete this request. Check the key or contact support.')
            : 'Unable to reach the licence service. Your saved licence remains available offline.',
      };
    }
    const credential = this.verifyGrant(value, device);
    const next: LicenceRecord = {
      ...saved,
      schemaVersion: 1,
      // A freshly signed online grant can recover a corrected system clock.
      lastSeenAt: this.now(),
      credential,
    };
    await this.write(next, device);
    this.updateCache.acceptAuthentication();
    onAccepted?.();
    return this.evaluate(next, device);
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
      if (licenseKey.length < 8 || licenseKey.length > 256 || /[\r\n\0]/.test(licenseKey))
        return Promise.resolve(
          this.summary('activation-required', null, false, 'Enter a valid licence key.'),
        );
      return this.acquire('activate', licenseKey.trim());
    }, true);
  readonly startTrial = () => this.safe(() => this.acquire('trial'), true);
  readonly refresh = () => this.safe(() => this.acquire('refresh'), true);
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
      try {
        const result = await this.request(
          '/v1/activations/deactivate',
          this.credentialBody(credential, device),
        );
        if (!record(result) || result.deactivated !== true)
          throw new Error('Deactivation was not confirmed');
      } catch {
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
        message: 'This device has been deactivated and its licence seat is available.',
      };
    }, true);
  readonly launch = () =>
    this.safe(async () => {
      if (this.authorized) return { ...(await this.readStatus()), sessionAuthorized: true };
      if (this.config.channel !== 'commercial') return this.readStatus();
      const { saved, device } = await this.load();
      const result = this.evaluate(saved, device);
      if (result.state !== 'ready') return result;
      await this.write(
        {
          ...saved,
          lastSeenAt: Math.max(saved.lastSeenAt, this.now()),
        },
        device,
      );
      this.authorized = true;
      try {
        this.options.onSessionAuthorized?.();
      } catch {
        /* Admission already succeeded. */
      }
      return { ...result, sessionAuthorized: true };
    });
  readonly sessionAuthorized = () => this.authorized;
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
          message:
            'Checkout opened in your browser. Return here and check payment when you have finished.',
        };
      } catch (error) {
        return {
          ...this.evaluate((await this.options.store.read()) ?? saved, device),
          message:
            error instanceof LicenceServiceError
              ? (ERRORS[error.code] ??
                'Checkout is unavailable. Your saved order will be retried without creating a duplicate.')
              : 'Checkout could not be opened. Your saved order can be retried without creating a duplicate.',
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
        return {
          ...activated,
          paymentPending: false,
          message: 'Payment confirmed. Your licence is ready.',
        };
      } catch (error) {
        return {
          ...this.evaluate((await this.options.store.read()) ?? saved, device),
          message:
            error instanceof LicenceServiceError
              ? (ERRORS[error.code] ?? 'Payment could not be confirmed yet. Please try again.')
              : 'Payment could not be confirmed yet. Please check your connection and try again.',
        };
      }
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
  private readonly renewalIdentity = (operation: string, saved: LicenceRecord, device: string) =>
    operation === 'renewal' && saved.credential !== undefined
      ? this.credentialBody(saved.credential, device)
      : undefined;
}

export type LicensingRuntime = ReturnType<typeof createLicensingRuntime>;

function displayDeviceName(value: string): string {
  return (
    value
      .replace(/[\p{Cc}\p{Cf}]/gu, '')
      .trim()
      .slice(0, 80) || 'KerfDesk device'
  );
}
