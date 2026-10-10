import { randomBytes } from 'node:crypto';
import { LicenceServiceError } from './licensing-http.js';
import { record } from './licensing-verification.js';
import type { LicensingConfig } from './licensing-config.js';
import type { LicenceStatus } from './licensing-status.js';
import type { LicenceRecord, LicensingStore } from './licensing-store.js';
import { SANDBOX_ORIGIN } from '../public/desktop-sandbox-contract.mjs';

export type LicencePayment = {
  readonly requestId: string;
  readonly operation: 'purchase' | 'renewal';
  readonly licenseKey?: string;
  readonly renewal?: RenewalIdentity;
  readonly order?: {
    readonly orderId: string;
    readonly claimToken: string;
    readonly checkoutUrl: string;
  };
};
type RenewalIdentity = {
  readonly licenseId: string;
  readonly activationId: string;
  readonly deviceId: string;
  readonly activationToken: string;
};

const CHECKOUT_PAGE = 'https://kerfdesk.com/buy.html?_ptxn=';

/**
 * A refusal before the first provider call can clear a newly created intent.
 * An inherited intent may have an order whose earlier response was lost: the
 * service checks configuration and renewal credentials before its prior-order
 * lookup, so these error codes cannot disprove that order on a retry.
 */
const UNPAYABLE_CHECKOUT_CODES: ReadonlySet<string> = new Set([
  'payment_provider_not_configured',
  'renewal_requires_paid_license',
  'invalid_credentials',
  'license_revoked',
  'license_inactive',
  'activation_inactive',
]);

/** Clears only a fresh intent refused before any provider call in this attempt. */
export function dropUnpayable(
  saved: LicenceRecord,
  error: unknown,
  beforeRequest: LicenceRecord,
): LicenceRecord {
  if (
    beforeRequest.payment !== undefined ||
    !(error instanceof LicenceServiceError) ||
    !UNPAYABLE_CHECKOUT_CODES.has(error.code) ||
    saved.payment === undefined ||
    saved.payment.order !== undefined
  )
    return saved;
  const { payment: _payment, ...withoutPayment } = saved;
  return withoutPayment;
}

/**
 * Buy Pro opens the first-party purchase page itself (owner's choice, 2026-10-09).
 * The page creates and claims the order in the browser and shows the key, which
 * the buyer then enters in Help > Licence; no order is saved on this device.
 * Renewals still start in the app, because the browser page is purchase-only.
 */
export function purchasePageUrl(sandbox = false): string {
  return `${sandbox ? SANDBOX_ORIGIN : 'https://kerfdesk.com'}/buy.html`;
}

export const PURCHASE_PAGE_OPENED =
  'The KerfDesk purchase page opened in your browser. After paying, copy the licence key it shows and enter it here under Licence key.';

export async function openPurchasePage(
  opener: { readonly openPurchasePage?: (url: string) => Promise<void> },
  config: LicensingConfig,
  status: LicenceStatus,
): Promise<LicenceStatus> {
  if (
    config.channel !== 'commercial' ||
    status.state === 'unavailable' ||
    status.tier === 'developer'
  )
    return status;
  const page = purchasePageUrl(config.sandbox === true);
  try {
    if (opener.openPurchasePage === undefined) throw new Error('Purchase page unavailable');
    await opener.openPurchasePage(page);
    return { ...status, message: PURCHASE_PAGE_OPENED };
  } catch {
    return {
      ...status,
      message: `The purchase page could not be opened. Visit ${page} in your browser, then enter your licence key here.`,
    };
  }
}

export function isLicenceCheckoutOperation(value: unknown): value is 'purchase' | 'renewal' {
  return value === 'purchase' || value === 'renewal';
}

/** A Paddle transaction ID, lower case only, exactly as the licence service accepts it. */
export function isTransactionId(value: string): boolean {
  return /^txn_[a-z0-9]{26}$/.test(value);
}

export function isLicenceCheckoutUrl(value: unknown, sandbox = false): value is string {
  const page = sandbox ? `${SANDBOX_ORIGIN}/buy.html?_ptxn=` : CHECKOUT_PAGE;
  return (
    typeof value === 'string' && value.startsWith(page) && isTransactionId(value.slice(page.length))
  );
}

export function validLicencePayment(value: unknown, sandbox = false): value is LicencePayment {
  if (
    !record(value) ||
    typeof value.requestId !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.requestId) ||
    !isLicenceCheckoutOperation(value.operation) ||
    (value.operation === 'renewal' &&
      !validRenewal(value.renewal) &&
      (typeof value.licenseKey !== 'string' ||
        value.licenseKey.length < 8 ||
        value.licenseKey.length > 256))
  )
    return false;
  return value.order === undefined || validOrder(value.order, sandbox);
}

function validOrder(
  value: unknown,
  sandbox = false,
): value is NonNullable<LicencePayment['order']> {
  return (
    record(value) &&
    typeof value.orderId === 'string' &&
    /^[A-Za-z0-9_-]{1,160}$/.test(value.orderId) &&
    typeof value.claimToken === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(value.claimToken) &&
    isLicenceCheckoutUrl(value.checkoutUrl, sandbox)
  );
}

function validRenewal(value: unknown): value is RenewalIdentity {
  return (
    record(value) &&
    typeof value.licenseId === 'string' &&
    typeof value.activationId === 'string' &&
    typeof value.deviceId === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(value.deviceId) &&
    typeof value.activationToken === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(value.activationToken)
  );
}

type CommerceDependencies = {
  readonly saved: LicenceRecord;
  readonly store: LicensingStore;
  readonly request: (path: string, body: unknown) => Promise<unknown>;
  readonly openCheckout: (url: string) => Promise<void>;
  readonly sandbox?: boolean;
};

/** Persist intent before the request, then proof before opening a browser. */
export async function prepareLicenceCheckout(
  deps: CommerceDependencies,
  operation: 'purchase' | 'renewal',
  licenseKey?: string,
  openBrowser = true,
  renewal?: RenewalIdentity,
): Promise<void> {
  if (!isLicenceCheckoutOperation(operation)) throw new Error('Checkout operation is invalid.');
  const payment = deps.saved.payment ?? newPayment(operation, licenseKey, renewal);
  // A retry always resumes the same operation and idempotency key.
  await deps.store.write({ ...deps.saved, payment });
  let order = payment.order;
  if (order === undefined) {
    order = await requestOrder(deps, payment);
    const completed = { ...payment, order };
    if (!validLicencePayment(completed, deps.sandbox))
      throw new Error('Checkout proof is invalid.');
    await deps.store.write({ ...deps.saved, payment: completed });
  }
  if (!validOrder(order, deps.sandbox)) throw new Error('Checkout destination is invalid.');
  if (openBrowser) await deps.openCheckout(order.checkoutUrl);
}

function newPayment(
  operation: 'purchase' | 'renewal',
  licenseKey?: string,
  renewal?: RenewalIdentity,
): LicencePayment {
  const requestId = randomBytes(32).toString('base64url');
  if (operation === 'purchase') return { requestId, operation };
  if (renewal !== undefined) return { requestId, operation, renewal };
  if (
    licenseKey === undefined ||
    licenseKey.length < 8 ||
    licenseKey.length > 256 ||
    /[\r\n\0]/.test(licenseKey)
  )
    throw new Error('Enter your licence key to renew updates.');
  return { requestId, operation, licenseKey: licenseKey.trim() };
}

async function requestOrder(
  deps: CommerceDependencies,
  payment: LicencePayment,
): Promise<NonNullable<LicencePayment['order']>> {
  const result = await deps.request('/v1/checkout', {
    requestId: payment.requestId,
    operation: payment.operation,
    ...(payment.licenseKey === undefined ? {} : { licenseKey: payment.licenseKey }),
    ...(payment.renewal ?? {}),
  });
  const priceMatches =
    record(result) &&
    result.currency === 'USD' &&
    result.amount === (payment.operation === 'purchase' ? 4950 : 2000);
  if (!priceMatches || !validOrder(result, deps.sandbox))
    throw new Error('Checkout was not confirmed.');
  return {
    orderId: result.orderId,
    claimToken: result.claimToken,
    checkoutUrl: result.checkoutUrl,
  };
}

export async function claimLicencePayment(deps: CommerceDependencies): Promise<string | null> {
  let saved = deps.saved;
  if (saved.payment === undefined) return null;
  if (saved.payment.order === undefined) {
    await prepareLicenceCheckout(deps, saved.payment.operation, saved.payment.licenseKey, false);
    saved = (await deps.store.read()) ?? saved;
  }
  const order = saved.payment?.order;
  if (order === undefined) throw new Error('Payment is still pending.');
  if (!validOrder(order, deps.sandbox)) throw new Error('Checkout destination is invalid.');
  const result = await deps.request('/v1/orders/claim', {
    orderId: order.orderId,
    claimToken: order.claimToken,
  });
  if (
    !record(result) ||
    typeof result.licenseKey !== 'string' ||
    result.licenseKey.length < 8 ||
    result.licenseKey.length > 256 ||
    /[\r\n\0]/.test(result.licenseKey)
  )
    throw new Error('Payment is still pending.');
  return result.licenseKey;
}
