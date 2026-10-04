import { describe, expect, it } from 'vitest';
import {
  oneTimePairingLink,
  pairingExpiryLabel,
  pairingQr,
  phoneControlUrl,
  PHONE_CONTROL_URL,
} from './pairing-link';
import { pairingFixture } from './pairing-test-support';

describe('one-time pairing link boundary', () => {
  it('preserves full computer identity and exact code only in the fragment', () => {
    const link = oneTimePairingLink(pairingFixture);
    expect(link).not.toBeNull();
    const url = new URL(link!);
    expect(`${url.origin}${url.pathname}`).toBe(PHONE_CONTROL_URL);
    expect(url.search).toBe('');
    expect([...new URLSearchParams(url.hash.slice(1))]).toEqual([
      ['device', pairingFixture.deviceId],
      ['code', pairingFixture.pairing!.code],
    ]);
    expect(url.hash).not.toMatch(/scope|edit|control|owner|token/);
  });
  it('uses the remaining server/native lease independently of the PC wall clock', () => {
    // Absolute expiry precedes the current wall clock but its native presentation lease is live.
    expect(oneTimePairingLink(pairingFixture)).not.toBeNull();
    expect(
      oneTimePairingLink({
        ...pairingFixture,
        pairing: { ...pairingFixture.pairing!, expiresInMs: 1 },
      }),
    ).not.toBeNull();
  });
  const invalid = [
    null,
    { ...pairingFixture, available: false },
    { ...pairingFixture, enabled: false },
    { ...pairingFixture, connected: false },
    { ...pairingFixture, pairingPending: true },
    { ...pairingFixture, deviceId: null },
    { ...pairingFixture, deviceId: 'short-code' },
    { ...pairingFixture, deviceId: '12345678-1234-4234-7234-123456789abc' },
    { ...pairingFixture, pairing: null },
    ...['x'.repeat(11), 'x'.repeat(25), 'PairCode12_A', 'PairCode12&A', 'PairCode12 A'].map(
      (code) => ({ ...pairingFixture, pairing: { ...pairingFixture.pairing!, code } }),
    ),
    ...[0, -1, 300_001, Infinity, NaN, 0.5].map((expiresInMs) => ({
      ...pairingFixture,
      pairing: { ...pairingFixture.pairing!, expiresInMs },
    })),
    { ...pairingFixture, pairing: { ...pairingFixture.pairing!, expiresAt: -1 } },
    ...[
      'http://kerfdesk-phone-control.cisgz3a.workers.dev/control',
      'https://foreign.example/control',
      'https://owner:secret@kerfdesk-phone-control.cisgz3a.workers.dev/control',
      'https://kerfdesk-phone-control.cisgz3a.workers.dev/mcp',
      'file:///private/control',
    ].map((controlUrl) => ({ ...pairingFixture, controlUrl })),
  ];
  it.each(invalid)('does not publish unavailable, malformed or expired offer %#', (status) => {
    expect(oneTimePairingLink(status)).toBeNull();
  });
  it('removes all old query/fragment metadata from manual page links', () => {
    expect(phoneControlUrl(`${PHONE_CONTROL_URL}?deviceId=old&code=secret#old`)).toBe(
      PHONE_CONTROL_URL,
    );
    expect(phoneControlUrl('https://foreign.example/control')).toBeNull();
  });
  it('bounds local QR input and formats the last second truthfully', () => {
    expect(pairingQr('x'.repeat(257))).toBeNull();
    expect(pairingExpiryLabel(300_000)).toBe('5:00');
    expect(pairingExpiryLabel(1)).toBe('0:01');
    expect(pairingExpiryLabel(0)).toBe('0:00');
  });
});
