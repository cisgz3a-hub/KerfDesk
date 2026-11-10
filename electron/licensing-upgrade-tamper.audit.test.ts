// @vitest-environment node
import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { SignedEntitlement } from './licensing-verification.js';
import {
  ISSUED,
  DAY,
  otherDevice,
  encode,
  harness,
  removeAuditProfiles,
} from './licensing-upgrade-retention.audit.test-support.js';

afterEach(removeAuditProfiles);

type Tamper = { name: string; change: (envelope: SignedEntitlement) => SignedEntitlement };
function payloadChange(
  envelope: SignedEntitlement,
  patch: Record<string, unknown>,
): SignedEntitlement {
  const claims = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString());
  return {
    ...envelope,
    payload: Buffer.from(JSON.stringify({ ...claims, ...patch })).toString('base64url'),
  };
}
const TAMPERS: Tamper[] = [
  {
    name: 'extended signed expiry',
    change: (e) => payloadChange(e, { accessExpiresAt: ISSUED + 365 * DAY }),
  },
  {
    name: 'changed signed tier',
    change: (e) => payloadChange(e, { tier: 'paid', accessExpiresAt: null }),
  },
  {
    name: 'changed signed product',
    change: (e) => payloadChange(e, { product: 'another-product' }),
  },
  { name: 'changed signed device', change: (e) => payloadChange(e, { deviceId: otherDevice }) },
  { name: 'unknown signing key', change: (e) => ({ ...e, keyId: 'unknown-key' }) },
  { name: 'noncanonical payload', change: (e) => ({ ...e, payload: `${e.payload}=` }) },
  {
    name: 'altered signature',
    change: (e) => ({
      ...e,
      signature: `${e.signature[0] === 'A' ? 'B' : 'A'}${e.signature.slice(1)}`,
    }),
  },
];

describe('fresh upgrade rejects altered saved authority without erasing the record', () => {
  it.each(TAMPERS)('rejects $name in a previously saved trial', async ({ change }) => {
    const h = await harness('trial');
    const saved = await h.store.read();
    if (saved?.credential === undefined) throw new Error('Expected the old saved credential.');
    await h.store.write({
      ...saved,
      credential: { ...saved.credential, entitlement: change(saved.credential.entitlement) },
    });
    const tampered = await readFile(h.file);
    expect(await h.runtime().status()).toMatchObject({ state: 'invalid-licence', edition: 'free' });
    expect(await readFile(h.file)).toEqual(tampered);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each(['paid', 'trial'] as const)(
    'rejects copied %s rights on a different installation',
    async (tier) => {
      const h = await harness(tier);
      const before = await readFile(h.file);
      expect(await h.runtime('1.0.8', otherDevice).status()).toMatchObject({
        state: 'invalid-licence',
        edition: 'free',
      });
      expect(await readFile(h.file)).toEqual(before);
    },
  );

  it.each([0, 2, null])(
    'preserves unsupported record schema %s for explicit recovery',
    async (schemaVersion) => {
      const h = await harness('paid');
      await writeFile(h.file, encode({ ...(await h.store.read()), schemaVersion }));
      const before = await readFile(h.file);
      expect(await h.runtime().status()).toMatchObject({
        state: 'invalid-licence',
        edition: 'free',
        storeUnreadable: true,
      });
      expect(await readFile(h.file)).toEqual(before);
    },
  );
});
