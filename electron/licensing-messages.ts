import { LicenceServiceError } from './licensing-http.js';

// What the licence panel says for each service answer (ADR-523, ADR-540,
// ADR-523 Amendment 2). Every code the service can send a device has a message
// here; licensing-messages.test.ts reads the service source to keep it that way.

const DEVICE_LIMIT =
  'This licence is already active on three devices. Deactivate one of them first, from that device’s Licence panel.';
const KEY_REFUSED = 'This licence key was not accepted. Check the key and try again.';
const RELEASED_HERE =
  'This computer was removed from its licence from another device. Enter your licence key to activate it again.';
const NOT_UNDERSTOOD =
  'The licence service could not process this request. Please try again later, or contact KerfDesk support if it keeps happening.';
const CHECKOUT_REFUSED =
  'Checkout could not be prepared, so nothing was charged. Please contact KerfDesk support.';
// Answers to a request this app never makes in that form; they mean the app and
// the service disagree, which an update or support resolves.
const PROTOCOL_CODES = [
  'invalid_request',
  'https_required',
  'client_address_required',
  'method_not_allowed',
  'not_found',
  'body_required',
  'body_too_large',
  'json_required',
  'invalid_json',
] as const;

/** A Map, so a code such as `constructor` can never reach an inherited member. */
export const ERRORS: ReadonlyMap<string, string> = new Map([
  ['device_limit_reached', DEVICE_LIMIT],
  ['trial_expired', 'The Pro trial on this device has ended. KerfDesk Free keeps working.'],
  ['invalid_credentials', KEY_REFUSED],
  ['invalid_license_tier', KEY_REFUSED],
  ['license_not_found', KEY_REFUSED],
  [
    'license_revoked',
    'This licence has been cancelled, so Pro tools are locked. KerfDesk Free keeps working. Contact KerfDesk support if this is unexpected.',
  ],
  [
    'license_inactive',
    'This licence is not active. Contact KerfDesk support if this is unexpected.',
  ],
  ['activation_released', RELEASED_HERE],
  ['activation_inactive', RELEASED_HERE],
  [
    'activation_not_found',
    'The licence service has no seat for this computer. Enter your licence key to activate it again.',
  ],
  [
    'release_limit_reached',
    'This licence has moved between devices too often in the last 30 days, so this computer stays active. Try again later or contact KerfDesk support.',
  ],
  ['rate_limited', 'Too many attempts. Please wait and try again.'],
  ['payment_pending', 'Payment is still pending. Complete checkout, then check payment again.'],
  [
    'checkout_pending',
    'Checkout is still being prepared. Try again in a few minutes. If it never opens, choose Forget this order in Help > Licence, then start a new checkout.',
  ],
  [
    'checkout_failed',
    'The payment provider could not start checkout, so nothing was charged. Choose Reopen checkout in Help > Licence to try again.',
  ],
  [
    'payment_rejected',
    'Your payment arrived but could not be matched to a licence. Please don’t pay again: email support@kerfdesk.com with the order number shown in Help > Licence.',
  ],
  ['payment_mismatch', CHECKOUT_REFUSED],
  ['provider_order_reused', CHECKOUT_REFUSED],
  [
    'invalid_provider_response',
    'The payment provider’s answer could not be checked, so checkout did not open and nothing was charged. Please try again later, or contact KerfDesk support if it keeps happening.',
  ],
  [
    'idempotency_conflict',
    'This saved order does not match what you are buying now. Choose Forget this order in Help > Licence, then start the checkout again.',
  ],
  [
    'renewal_requires_paid_license',
    'Only a paid Pro licence can renew its updates. Contact KerfDesk support if this licence should be renewable.',
  ],
  [
    'payment_provider_not_configured',
    'Online checkout is not available yet. You can still activate an existing licence.',
  ],
  [
    'service_unavailable',
    'The licence service is not available right now. Please try again later.',
  ],
  ...PROTOCOL_CODES.map((code) => [code, NOT_UNDERSTOOD] as const),
]);

/** The message for a service error code, or null for a code this app does not know. */
export function errorMessage(code: string): string | null {
  return ERRORS.get(code) ?? null;
}

// Only an explicit server answer removes saved rights. A missing record, an
// outage or a configuration fault never does (ADR-523 Amendment 1).
export const RELEASED = new Set(['activation_released', 'activation_inactive']);
export const REVOKED = new Set(['license_revoked']);
const FREE_HERE =
  'Enter your licence key to use Pro here again, or contact KerfDesk support to free the seat.';
export const MESSAGES = {
  unreadable:
    'The licence saved on this computer can’t be read, for example after a Windows account or password reset, so Pro tools are locked. Everything else works. Reset it, then enter your licence key again; this computer keeps its licence seat.',
  unavailable:
    'The licence service or this computer’s secure storage is unavailable, so Pro tools may be locked. Everything else works. Check your connection and that you are signed in to your operating-system account, then try again.',
  unconfirmed:
    'The licence service could not confirm this licence. Your saved licence keeps working.',
  deactivated: 'This device has been deactivated and its licence seat is free for another device.',
  seatNotFreed: `This computer is signed out of its licence, but its seat could not be freed from here, so it may still count as one of your three devices. ${FREE_HERE}`,
  pendingCleared: `This computer stopped trying to free its licence seat, so the seat may still count as one of your three devices. ${FREE_HERE}`,
  reset:
    'The saved licence was cleared. Enter your licence key, or start the trial again if you were trying Pro; this computer keeps its seat.',
  nothingToReset: 'The saved licence can be read again, so it was kept and nothing was reset.',
  checkoutOpened:
    'Checkout opened in your browser. Return here and choose Check payment when you have finished.',
  paid: 'Payment confirmed and Pro is unlocked. Copy your licence key below and keep it safe: you need it to activate KerfDesk on your other computers.',
  orderForgotten: 'The saved order was removed from this computer. You can start a new checkout.',
} as const;

/** After a key unlocks paid Pro, an unfinished purchase no longer hides Renew (ADR-523 Amendment 2). */
export function staleOrderMessage(orderId: string | null): string {
  const removed =
    'Pro is unlocked with your licence key, and the unfinished order saved on this computer was removed.';
  return orderId === null
    ? removed
    : `${removed} If you did pay for order ${orderId}, email support@kerfdesk.com with that order number.`;
}

/** The message for a request the service refused or never answered. */
export function requestFailureMessage(error: unknown): string {
  if (!(error instanceof LicenceServiceError))
    return 'Unable to reach the licence service. Your saved licence keeps working offline.';
  return (
    errorMessage(error.code) ??
    'The licence service could not complete this request. Check the key or contact support.'
  );
}

// Refresh answers that say something true about this device's rights; any other
// refused refresh leaves the saved licence working as it is.
const REFRESH_ANSWERS = new Set([
  'rate_limited',
  'service_unavailable',
  'trial_expired',
  'license_inactive',
]);

/** A refresh answer that leaves this device's rights as they are. */
export function refreshFailureMessage(code: string): string | null {
  return REFRESH_ANSWERS.has(code) ? errorMessage(code) : MESSAGES.unconfirmed;
}

export function checkoutFailureMessage(error: unknown): string {
  return error instanceof LicenceServiceError
    ? (errorMessage(error.code) ??
        'Checkout is unavailable. Your saved order will be retried without creating a duplicate.')
    : 'Checkout could not be opened. Your saved order can be retried without creating a duplicate.';
}

export function paymentFailureMessage(error: unknown): string {
  return error instanceof LicenceServiceError
    ? (errorMessage(error.code) ?? 'Payment could not be confirmed yet. Please try again.')
    : 'Payment could not be confirmed yet. Please check your connection and try again.';
}

export function displayDeviceName(value: string): string {
  return (
    value
      .replace(/[\p{Cc}\p{Cf}]/gu, '')
      .trim()
      .slice(0, 80) || 'KerfDesk device'
  );
}
