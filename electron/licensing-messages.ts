import { LicenceServiceError } from './licensing-http.js';

// What the licence panel says for each service answer (ADR-523, ADR-540).

const DEVICE_LIMIT =
  'This licence is already active on three devices. Deactivate one of them first, from that device’s Licence panel.';
const KEY_REFUSED = 'This licence key was not accepted. Check the key and try again.';
const RELEASED_HERE =
  'This computer was removed from its licence from another device. Enter your licence key to activate it again.';
export const ERRORS: Readonly<Record<string, string>> = {
  device_limit: DEVICE_LIMIT,
  device_limit_reached: DEVICE_LIMIT,
  trial_already_used:
    'The Pro trial on this device has already been used. Buy a licence or enter your key to use Pro.',
  trial_expired: 'The Pro trial on this device has ended. KerfDesk Free keeps working.',
  invalid_license: KEY_REFUSED,
  invalid_credentials: KEY_REFUSED,
  license_not_found: KEY_REFUSED,
  license_revoked:
    'This licence has been cancelled, so Pro tools are locked. KerfDesk Free keeps working. Contact KerfDesk support if this is unexpected.',
  license_inactive: 'This licence is not active. Contact KerfDesk support if this is unexpected.',
  activation_released: RELEASED_HERE,
  activation_inactive: RELEASED_HERE,
  release_limit_reached:
    'This licence has moved between devices too often in the last 30 days, so this computer stays active. Try again later or contact KerfDesk support.',
  rate_limited: 'Too many attempts. Please wait and try again.',
  payment_pending: 'Payment is still pending. Complete checkout, then check payment again.',
  checkout_pending: 'Checkout is still being prepared. Please check payment again shortly.',
  payment_provider_not_configured:
    'Online checkout is not available yet. You can still activate an existing licence.',
  service_unavailable: 'The licence service is not available right now. Please try again later.',
};
// Only an explicit server answer removes saved rights. A missing record, an
// outage or a configuration fault never does (ADR-523 Amendment 1).
export const RELEASED = new Set(['activation_released', 'activation_inactive']);
export const REVOKED = new Set(['license_revoked']);
export const MESSAGES = {
  unreadable:
    'The licence saved on this computer can’t be read, for example after a Windows account or password reset, so Pro tools are locked. Everything else works. Reset it, then enter your licence key again; this computer keeps its licence seat.',
  unavailable:
    'The licence service or this computer’s secure storage is unavailable, so Pro tools may be locked. Everything else works. Check your connection and that you are signed in to your operating-system account, then try again.',
  unconfirmed:
    'The licence service could not confirm this licence. Your saved licence keeps working.',
  deactivated: 'This device has been deactivated and its licence seat is free for another device.',
  reset:
    'The saved licence was cleared. Enter your licence key, or start the trial again if you were trying Pro; this computer keeps its seat.',
  checkoutOpened:
    'Checkout opened in your browser. Return here and choose Check payment when you have finished.',
  paid: 'Payment confirmed and Pro is unlocked. Copy your licence key below and keep it safe: you need it to activate KerfDesk on your other computers.',
  orderForgotten: 'The saved order was removed from this computer. You can start a new checkout.',
} as const;

/** The message for a request the service refused or never answered. */
export function requestFailureMessage(error: unknown): string {
  if (!(error instanceof LicenceServiceError))
    return 'Unable to reach the licence service. Your saved licence keeps working offline.';
  return (
    ERRORS[error.code] ??
    'The licence service could not complete this request. Check the key or contact support.'
  );
}

/** A refresh answer that leaves this device's rights as they are. */
export function refreshFailureMessage(code: string): string | null {
  return code === 'rate_limited' || code === 'service_unavailable'
    ? (ERRORS[code] ?? null)
    : MESSAGES.unconfirmed;
}

export function checkoutFailureMessage(error: unknown): string {
  return error instanceof LicenceServiceError
    ? (ERRORS[error.code] ??
        'Checkout is unavailable. Your saved order will be retried without creating a duplicate.')
    : 'Checkout could not be opened. Your saved order can be retried without creating a duplicate.';
}

export function paymentFailureMessage(error: unknown): string {
  return error instanceof LicenceServiceError
    ? (ERRORS[error.code] ?? 'Payment could not be confirmed yet. Please try again.')
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
