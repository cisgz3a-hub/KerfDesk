import assert from 'node:assert/strict';
import test from 'node:test';
import { digest } from './commercial-release-manifest.mjs';
import { originalReceiptContext, verifyArtifactBytes } from './desktop-receipt-recovery.mjs';
import { readRecoveryArchive } from './desktop-receipt-recovery-archive.mjs';
import { readOriginalReceiptEvidence } from './recover-desktop-release-receipt.mjs';
import { retainReleaseReceipt } from './desktop-release-receipt.mjs';
import { archive } from './desktop-receipt-recovery-test-support.mjs';
import { fixture, sourceSha } from './desktop-release-receipt-test-support.mjs';

test('protected recovery authenticates selected archive data and preserves original historical receipt bytes', async () => {
  const f = await fixture();
  const originalReceipt = await retainReleaseReceipt(f);
  const signed = Buffer.from(f.objects.get(originalReceipt.key));
  const request = { runId: '12345', runAttempt: '2', sourceSha, version: '1.2.3' };
  const members = {
    delivery: {
      'commercial-preparation/commercial-release-identity.json': f.identity,
      'unsigned-dependency-audit/report.json': f.dependencyAudit,
      'public-desktop-delivery/public-delivery.json': f.delivery,
    },
    qualification: {
      'release/commercial-unsigned/1.2.3/installer-qualification/qualification.json': f.launch,
      'release/commercial-unsigned/1.2.3/installer-qualification/asar-restoration.json':
        f.restoration,
      'artifacts/installed-qualification/historical-upgrade/qualification.json': f.upgrade,
      'artifacts/historical-installers/1.2.2/download-manifest.json': f.previousManifest,
    },
    installer: {
      'release/commercial-unsigned/1.2.3/KerfDesk-1.2.3-windows-x64-setup.exe':
        'candidate installer',
    },
  };
  const archives = Object.fromEntries(
    Object.entries(members).map(([kind, files]) => {
      const bytes = archive(
        Object.entries(files).map(([name, value]) => ({
          name: 'runner/' + name,
          text: Buffer.isBuffer(value)
            ? value.toString('utf8')
            : typeof value === 'string'
              ? value
              : JSON.stringify(value),
          method: 8,
        })),
      );
      return [
        kind,
        readRecoveryArchive(
          verifyArtifactBytes(
            { size_in_bytes: bytes.length, digest: 'sha256:' + digest(bytes) },
            bytes,
          ),
        ),
      ];
    }),
  );
  const evidence = readOriginalReceiptEvidence({
    request,
    original: { firstRelease: false },
    archives,
    keySet: f.keySet,
  });
  f.objects.set('desktop/commercial-manual/latest.json', Buffer.from('newer release pointer'));
  const result = await retainReleaseReceipt({
    ...f,
    ...evidence,
    context: originalReceiptContext(request),
  });
  assert.equal(result.status, 'already-retained');
  assert.equal(result.key, originalReceipt.key);
  assert.deepEqual(f.objects.get(result.key), signed);
  assert.equal(f.writes.length, 1);
  await assert.rejects(
    retainReleaseReceipt({
      ...f,
      ...evidence,
      lockfileSha256: digest(Buffer.from('new current lockfile')),
    }),
  );
  evidence.dependencyAudit.runAttempt = '1';
  await assert.rejects(retainReleaseReceipt({ ...f, ...evidence }));
  assert.equal(f.writes.length, 1);
});
