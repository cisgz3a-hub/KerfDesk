import assert from 'node:assert/strict';
import test from 'node:test';
import { manualDownloadKey } from '../public/desktop-manual-download.mjs';
import { MANUAL_CATALOG_KEY } from '../public/desktop-manual-catalog.mjs';
import { verifySignedEnvelope } from '../public/desktop-release-manifest.mjs';
import { digest } from './commercial-release-manifest.mjs';
import { releaseReceiptContext, retainReleaseReceipt } from './desktop-release-receipt.mjs';
import { parseReceiptArguments } from './publish-desktop-release-receipt.mjs';
import * as support from './commercial-release-test-support.mjs';
import {
  file,
  blob,
  sourceSha,
  previousSha,
  env,
  fixture,
} from './desktop-release-receipt-test-support.mjs';

test('retains compact independently verifiable success evidence and exact retries write nothing', async () => {
  const f = await fixture();
  const result = await retainReleaseReceipt(f);
  assert.equal(result.status, 'retained');
  assert.match(result.key, /1\.2\.3\/release-receipts\/12345-2\.json$/u);
  assert.equal(f.writes.length, 1);
  const bytes = f.objects.get(result.key);
  assert.ok(bytes.length < 32_768);
  const payload = await verifySignedEnvelope(JSON.parse(bytes), support.keySet, 'stable');
  assert.equal(payload.manifestSha256, digest(f.manifest));
  assert.deepEqual(payload.installer, f.installer);
  assert.equal(payload.qualification.upgrade.status, 'passed');
  assert.equal(payload.qualification.asar.restored, true);
  assert.doesNotMatch(JSON.stringify(payload), /private|secret-token|secret title|Bearer|C:\\/u);
  assert.equal((await retainReleaseReceipt(f)).status, 'already-retained');
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].metadata.cacheControl, 'public, max-age=31536000, immutable');
});

const mutations = [
  [
    'missing website proof',
    (f) => {
      f.delivery.website = null;
    },
  ],
  [
    'wrong website release',
    (f) => {
      f.delivery.website.version = '1.2.2';
    },
  ],
  [
    'wrong website installer',
    (f) => {
      f.delivery.website.installerUrl = 'https://example.com/setup.exe';
    },
  ],
  [
    'changed saved project',
    (f) => {
      f.upgrade.steps.find((step) => step.name === 'historical-upgrade-reopen').project =
        file('changed');
    },
  ],
  [
    'wrong candidate installer',
    (f) => {
      f.installer = { ...f.installer, sha256: '0'.repeat(64) };
    },
  ],
  [
    'wrong workflow',
    (f) => {
      f.context.workflow = 'another-workflow';
    },
  ],
  [
    'wrong source',
    (f) => {
      f.context.sourceSha = previousSha;
    },
  ],
  [
    'failed launch',
    (f) => {
      f.launch.status = 'failed';
    },
  ],
  [
    'other run evidence',
    (f) => {
      f.launch.runId = '999';
    },
  ],
  [
    'other attempt',
    (f) => {
      f.launch.runAttempt = '1';
    },
  ],
  [
    'wrong launch installer',
    (f) => {
      f.launch.candidates[0].file = file('wrong');
    },
  ],
  [
    'missing launch',
    (f) => {
      f.launch.steps.splice(1, 1);
    },
  ],
  [
    'duplicate launch',
    (f) => {
      f.launch.steps.push(f.launch.steps[0]);
    },
  ],
  [
    'different installed archive',
    (f) => {
      f.launch.steps[0].installed.asar = file('other');
    },
  ],
  [
    'wrong upgrade source',
    (f) => {
      f.upgrade.upgradeSourceCommit = previousSha;
    },
  ],
  [
    'incomplete upgrade',
    (f) => {
      f.upgrade.steps.pop();
    },
  ],
  [
    'missing retained profile',
    (f) => {
      delete f.upgrade.retainedProfileSentinel;
    },
  ],
  [
    'changed archive after probe',
    (f) => {
      f.restoration.afterSha256 = '0'.repeat(64);
    },
  ],
  [
    'probe failure',
    (f) => {
      f.restoration.exitCode = 1;
    },
  ],
  [
    'runtime advisory',
    (f) => {
      f.dependencyAudit.runtimeCount = 1;
    },
  ],
  [
    'wrong dependency lockfile',
    (f) => {
      f.dependencyAudit.lockfileSha256 = '0'.repeat(64);
    },
  ],
  [
    'wrong dependency source',
    (f) => {
      f.dependencyAudit.sourceSha = previousSha;
    },
  ],
  [
    'invalid advisory counts',
    (f) => {
      f.dependencyAudit.releaseBuildOnlyCount = 0;
    },
  ],
  [
    'public installer unverified',
    (f) => {
      f.delivery.checks.installerBytes = false;
    },
  ],
  [
    'wrong public manifest',
    (f) => {
      f.delivery.manifestSha256 = '0'.repeat(64);
    },
  ],
  [
    'wrong public source',
    (f) => {
      f.delivery.sourceSha = previousSha;
    },
  ],
  [
    'executed installer',
    (f) => {
      f.delivery.installerExecuted = true;
    },
  ],
  [
    'bad prior signature',
    (f) => {
      const envelope = JSON.parse(f.previousManifest);
      envelope.signature = 'A'.repeat(86) + '==';
      f.previousManifest = blob(envelope);
    },
  ],
];
for (const [name, mutate] of mutations)
  test(`refuses ${name} before any storage write`, async () => {
    const f = await fixture();
    mutate(f);
    await assert.rejects(retainReleaseReceipt(f));
    assert.equal(f.writes.length, 0);
  });

test('does not replace a conflicting existing success receipt', async () => {
  const f = await fixture();
  const result = await retainReleaseReceipt(f);
  f.delivery.website.screenshot = 'new-screenshot.png';
  await assert.rejects(retainReleaseReceipt(f), /conflicts/u);
  assert.equal(f.writes.length, 1);
  assert.equal(digest(f.objects.get(result.key)), result.sha256);
});

test('refuses a changed immutable manifest or failed receipt readback', async () => {
  const f = await fixture();
  f.objects.set(manualDownloadKey('1.2.3', 'download-manifest.json'), Buffer.from('changed'));
  await assert.rejects(retainReleaseReceipt(f), /manifest readback/u);
  assert.equal(f.writes.length, 0);
  f.objects.set(manualDownloadKey('1.2.3', 'download-manifest.json'), f.manifest);
  f.store.put = async () => undefined;
  await assert.rejects(retainReleaseReceipt(f), /receipt readback/u);
});

test('first-release exception requires an authenticated catalogue containing only this release', async () => {
  const f = await fixture();
  f.firstRelease = true;
  delete f.upgrade;
  delete f.previousManifest;
  await assert.rejects(retainReleaseReceipt(f), /first release/u);
  assert.equal(f.writes.length, 0);
  f.objects.set(
    MANUAL_CATALOG_KEY,
    blob({ schemaVersion: 1, kind: 'manual-download-catalog', releases: [f.manifestEnvelope] }),
  );
  const result = await retainReleaseReceipt(f);
  const payload = await verifySignedEnvelope(
    JSON.parse(f.objects.get(result.key)),
    support.keySet,
    'stable',
  );
  assert.equal(payload.qualification.upgrade.status, 'not-applicable-first-release');
});

test('CLI rejects missing, duplicate, unknown and contradictory evidence options', () => {
  const args = [
    '--identity',
    'identity',
    '--installer',
    'app.exe',
    '--launch',
    'launch',
    '--asar-restoration',
    'restored',
    '--dependency-audit',
    'audit',
    '--public-delivery',
    'delivery',
  ];
  assert.equal(parseReceiptArguments([...args, '--first-release']).firstRelease, true);
  assert.equal(
    parseReceiptArguments([...args, '--upgrade', 'upgrade', '--previous-manifest', 'old'])
      .firstRelease,
    false,
  );
  for (const invalid of [
    args,
    [...args, '--first-release', '--first-release'],
    [...args, '--first-release', '--upgrade', 'upgrade'],
    [...args, '--first-release', '--identity', 'again'],
    [...args, '--other', 'value'],
  ])
    assert.throws(() => parseReceiptArguments(invalid));
  assert.throws(() =>
    releaseReceiptContext({ ...env, RELEASE_SOURCE_SHA: previousSha }, sourceSha),
  );
});
