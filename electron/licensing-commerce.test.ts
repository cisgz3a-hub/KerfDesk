// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  isLicenceCheckoutOperation,
  prepareLicenceCheckout,
  validLicencePayment,
} from './licensing-commerce';
import type { LicenceRecord } from './licensing-store';

const invalidOperations = [
  undefined,
  null,
  1,
  [],
  ['purchase'],
  ['renewal'],
  { toString: 'purchase' },
];
const payment = (operation: unknown) => ({
  requestId: 'a'.repeat(43),
  operation,
  licenseKey: 'test-key',
});

describe('strict licence checkout operation admission', () => {
  it.each(['purchase', 'renewal'])('keeps a normal %s payment valid', (operation) => {
    expect(isLicenceCheckoutOperation(operation)).toBe(true);
    expect(validLicencePayment(payment(operation))).toBe(true);
  });
  it.each(invalidOperations)(
    'refuses malformed stored payment operations without coercion: %j',
    (operation) => {
      expect(isLicenceCheckoutOperation(operation)).toBe(false);
      expect(validLicencePayment(payment(operation))).toBe(false);
    },
  );
  it('does not evaluate an untrusted coercion getter', () => {
    const coercion = vi.fn(() => {
      throw new Error('Untrusted getter');
    });
    const operation = Object.defineProperty({}, 'toString', { get: coercion });
    expect(isLicenceCheckoutOperation(operation)).toBe(false);
    expect(validLicencePayment(payment(operation))).toBe(false);
    expect(coercion).not.toHaveBeenCalled();
  });
  it.each([['purchase'], ['renewal'], { toString: 'purchase' }])(
    'refuses a malformed direct commerce call before persisting or requesting an order: %j',
    async (operation) => {
      const store = {
        read: vi.fn(async (): Promise<LicenceRecord | null> => null),
        write: vi.fn(async () => undefined),
        reset: vi.fn(async () => undefined),
      };
      const request = vi.fn(async () => ({}));
      const openCheckout = vi.fn(async () => undefined);
      await expect(
        prepareLicenceCheckout(
          { saved: { schemaVersion: 1, lastSeenAt: 0 }, store, request, openCheckout },
          operation as unknown as 'purchase' | 'renewal',
          'test-key',
        ),
      ).rejects.toThrow('Checkout operation is invalid.');
      expect(store.write).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      expect(openCheckout).not.toHaveBeenCalled();
    },
  );
});
