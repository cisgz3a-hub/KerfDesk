import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANUAL_CATALOG_LIMIT,
  MANUAL_CATALOG_RELEASE_LIMIT,
  verifyManualCatalog,
} from '../public/desktop-manual-catalog.mjs';
import { manualDownloadPayload, signManualDownload } from './manual-commercial-manifest.mjs';
import { prepareManualHistory } from './manual-commercial-history.mjs';
import * as stable from './commercial-release-test-support.mjs';
import * as preview from './preview-release-test-support.mjs';

async function signedRelease(version) {
  return signManualDownload(
    manualDownloadPayload(stable.fixture(version).identity, Buffer.from(version), stable.keySet),
    stable.privateKeyPem,
    stable.keyId,
    stable.keySet,
  );
}

const catalog = (releases) =>
  JSON.stringify({ schemaVersion: 1, kind: 'manual-download-catalog', releases });

test('manual history accepts only original stable-key signed manifests and sorts numerically', async () => {
  const envelopes = await Promise.all(['1.9.0', '1.2.0', '1.10.0'].map(signedRelease));
  const entries = await verifyManualCatalog(catalog(envelopes), stable.keySet);
  assert.deepEqual(
    entries.map(({ release }) => release.version),
    ['1.10.0', '1.9.0', '1.2.0'],
  );
  assert.deepEqual(entries[0].envelope, envelopes[2]);
  await assert.rejects(verifyManualCatalog(catalog(envelopes), preview.keySet));
});

test('manual history rejects duplicates, untrusted records, oversized input and schema extensions', async () => {
  const good = await signedRelease('1.2.3');
  const payload = JSON.parse(Buffer.from(good.payload, 'base64'));
  for (const text of [
    catalog([good, good]),
    catalog([{ ...good, signature: Buffer.alloc(64).toString('base64') }]),
    catalog([
      stable.signed({
        ...payload,
        artifacts: [{ ...payload.artifacts[0], name: '../../evil.exe' }],
      }),
    ]),
    catalog([stable.signed({ ...payload, url: 'https://attacker.invalid/evil.exe' })]),
    catalog([stable.signed({ ...payload, channel: 'preview' })]),
    catalog(Array(MANUAL_CATALOG_RELEASE_LIMIT + 1).fill(good)),
    `${' '.repeat(MANUAL_CATALOG_LIMIT)}${catalog([good])}`,
    JSON.stringify({ ...JSON.parse(catalog([good])), extra: true }),
    JSON.stringify({ schemaVersion: 1, releases: [good] }),
    'null',
  ])
    await assert.rejects(verifyManualCatalog(text, stable.keySet));
});

test('full history refuses another release instead of pruning customers covered versions', async () => {
  const envelopes = await Promise.all(
    Array.from({ length: MANUAL_CATALOG_RELEASE_LIMIT }, (_, index) =>
      signedRelease(`1.0.${index}`),
    ),
  );
  const bytes = Buffer.from(catalog(envelopes));
  const candidate = await signedRelease(`1.0.${MANUAL_CATALOG_RELEASE_LIMIT}`);
  const latest = Buffer.from(JSON.stringify(envelopes.at(-1)));
  await assert.rejects(
    prepareManualHistory({ get: async () => bytes }, latest, candidate, stable.keySet),
    /Invalid manual download catalogue/u,
  );
  assert.equal(
    (await verifyManualCatalog(bytes.toString(), stable.keySet)).length,
    MANUAL_CATALOG_RELEASE_LIMIT,
  );
});

test('a conflicting latest or an archive ahead of the candidate cannot be republished', async () => {
  const first = await signedRelease('1.2.3');
  const future = await signedRelease('1.2.4');
  const sameVersion = await signManualDownload(
    manualDownloadPayload(
      stable.fixture('1.2.3').identity,
      Buffer.from('different bytes'),
      stable.keySet,
    ),
    stable.privateKeyPem,
    stable.keyId,
    stable.keySet,
  );
  for (const [entries, latest, candidate] of [
    [[sameVersion], first, future],
    [[first, future], first, first],
  ]) {
    const store = { get: async () => Buffer.from(catalog(entries)) };
    await assert.rejects(
      prepareManualHistory(store, Buffer.from(JSON.stringify(latest)), candidate, stable.keySet),
      /(?:conflicts|ahead)/u,
    );
  }
});
