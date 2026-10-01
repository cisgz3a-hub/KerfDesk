import { createPrivateKey, sign } from 'node:crypto';
import { commercialArtifactNames } from '../public/desktop-commercial-catalog.mjs';
import {
  validateManualDownload,
  verifyManualDownload,
} from '../public/desktop-manual-download.mjs';
import {
  CommercialReleaseError,
  digest,
  verifyCommercialEnvelope,
} from './commercial-release-manifest.mjs';

export function manualDownloadPayload(identityEnvelope, installer, keySet) {
  const identity = verifyCommercialEnvelope(identityEnvelope, keySet, 'release-identity');
  if (!Buffer.isBuffer(installer) || installer.length < 1 || installer.length > 300_000_000)
    throw new CommercialReleaseError('Manual release requires one bounded Windows installer.');
  return validateManualDownload({
    ...identity,
    kind: 'manual-download',
    codeSigning: 'unsigned',
    updates: 'manual',
    artifacts: [
      {
        name: commercialArtifactNames(identity.version)[0],
        bytes: installer.length,
        sha256: digest(installer),
      },
    ],
  });
}

export async function signManualDownload(payload, privateKeyPem, keyId, keySet) {
  validateManualDownload(payload);
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519')
    throw new CommercialReleaseError('Manual release requires an Ed25519 signing key.');
  const bytes = Buffer.from(JSON.stringify(payload));
  const envelope = {
    schemaVersion: 1,
    keyId,
    algorithm: 'Ed25519',
    payload: bytes.toString('base64'),
    signature: sign(null, bytes, key).toString('base64'),
  };
  await verifyManualDownload(JSON.stringify(envelope), keySet);
  return envelope;
}
