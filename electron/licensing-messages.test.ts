// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LicenceServiceError } from './licensing-http';
import {
  checkoutFailureMessage,
  ERRORS,
  errorMessage,
  MESSAGES,
  paymentFailureMessage,
  refreshFailureMessage,
  requestFailureMessage,
} from './licensing-messages';

const SERVICE = new URL('../services/desktop-licensing/', import.meta.url);
// Codes the client must always know, whatever the scan below finds (ADR-523
// Amendments 2 and 3): the service's checkout and claim routes send them.
const EXPECTED_FROM_SERVICE = ['checkout_failed', 'payment_rejected'];
// Answers only Paddle's webhook or the private admin API can receive. The app calls
// only /v1/trials/start, /v1/licenses/activate, /v1/activations/refresh,
// /v1/activations/deactivate, /v1/checkout and /v1/orders/claim.
const NEVER_SENT_TO_DEVICES = new Set([
  'invalid_payment_signature',
  'invalid_payment',
  'unknown_order',
  'payment_not_completed',
  'payment_reused',
  'order_already_paid',
  'license_already_exists',
  'order_not_found',
  // Only the admin API's customer deletion refuses a licence that is still active.
  'license_not_revoked',
  // Key-email outcomes recorded on an order for support (licence-email.mjs).
  'no_address',
  'send_failed',
  // Only the authenticated admin reconciliation route can return these.
  'order_not_pending',
  'reconciliation_unavailable',
  'transaction_not_found',
]);

/** Every error code in the service source: `requireValue(…, 409, 'code')`, `code: 'code'`. */
function serviceCodes(): Set<string> {
  const codes = new Set<string>();
  const files = readdirSync(SERVICE).filter(
    (name) => name.endsWith('.mjs') && !name.includes('.test.') && name !== 'test-support.mjs',
  );
  for (const name of files) {
    const source = readFileSync(fileURLToPath(new URL(name, SERVICE)), 'utf8');
    for (const match of source.matchAll(/\b\d{3}\s*,\s*'([a-z][a-z0-9_]*)'\s*,?\s*\)/g))
      codes.add(match[1] ?? '');
    for (const match of source.matchAll(/\bcode\s*[:=]\s*'([a-z][a-z0-9_]*)'/g))
      codes.add(match[1] ?? '');
  }
  return codes;
}

describe('licence service error codes (ADR-523 Amendment 2)', () => {
  it('has a message for every code the service can send this app', () => {
    const codes = serviceCodes();
    // Guards the scan itself: if the service changed how it names codes, fail loudly.
    for (const known of [
      'rate_limited',
      'invalid_credentials',
      'checkout_pending',
      'trial_expired',
    ])
      expect(codes).toContain(known);
    expect(codes.size).toBeGreaterThan(25);
    const expected = [...codes, ...EXPECTED_FROM_SERVICE].filter(
      (code) => !NEVER_SENT_TO_DEVICES.has(code),
    );
    expect(expected.filter((code) => errorMessage(code) === null)).toEqual([]);
  });
  it('never resolves a code to an inherited object member', () => {
    for (const code of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(errorMessage(code)).toBeNull();
      expect(typeof requestFailureMessage(new LicenceServiceError(code))).toBe('string');
      expect(typeof checkoutFailureMessage(new LicenceServiceError(code))).toBe('string');
      expect(typeof paymentFailureMessage(new LicenceServiceError(code))).toBe('string');
      expect(refreshFailureMessage(code)).toBe(MESSAGES.unconfirmed);
    }
    expect(ERRORS.has('constructor')).toBe(false);
  });
  it('does not promise the saved licence keeps working when a refresh says it ended', () => {
    for (const code of ['trial_expired', 'license_inactive']) {
      expect(refreshFailureMessage(code)).toBe(errorMessage(code));
      expect(refreshFailureMessage(code)).not.toContain('saved licence keeps working');
    }
    expect(refreshFailureMessage('internal_error')).toBe(MESSAGES.unconfirmed);
  });
  it('points a checkout that never becomes ready to Forget this order', () => {
    expect(errorMessage('checkout_pending')).toContain('Forget this order');
    expect(errorMessage('checkout_failed')).toContain('nothing was charged');
    expect(errorMessage('payment_rejected')).toContain('support@kerfdesk.com');
    expect(errorMessage('payment_rejected')).toContain('don’t pay again');
  });
});
