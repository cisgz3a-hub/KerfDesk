import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import asar from '@electron/asar';
import { prepareCommercialMetadata } from './prepare-commercial-desktop.mjs';
import { verifyPackagedCommercialAsar } from './verify-packaged-commercial-metadata.mjs';
import { assertPackagedArchiveComplete } from './verify-packaged-preview-metadata.mjs';

const VERSION = '1.2.3';
const spki = (pair) => pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const stable = generateKeyPairSync('ed25519');
const keySets = {
  entitlementKeySet: {
    schemaVersion: 1,
    keys: [
      {
        keyId: 'entitlement-test',
        algorithm: 'Ed25519',
        publicKeySpki: spki(generateKeyPairSync('ed25519')),
      },
    ],
  },
  releaseKeySet: {
    schemaVersion: 1,
    keys: [
      {
        keyId: 'stable-test',
        algorithm: 'Ed25519',
        channel: 'stable',
        publicKeySpki: spki(stable),
      },
    ],
  },
};

function metadata(version = VERSION) {
  return prepareCommercialMetadata({
    version,
    sourceSha: 'a'.repeat(40),
    sourceRef: 'refs/heads/main',
    publishedAt: '2026-09-28T12:00:00.000Z',
    keyId: 'stable-test',
    privateKeyPem: stable.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    unsignedInstaller: true,
    ...keySets,
  });
}

// See verify-packaged-preview-metadata.test.mjs: createPackage can settle before its bytes land.
async function settled(archive) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    asar.uncache(archive);
    try {
      assertPackagedArchiveComplete(archive);
      return archive;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function archiveWith(packageJson, rendererVersion = VERSION) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kerfdesk-commercial-metadata-'));
  const source = path.join(root, 'source');
  const assets = path.join(source, 'dist', 'web', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify(packageJson));
  fs.writeFileSync(
    path.join(assets, 'about.js'),
    `const about = "Terms of use: License & Safety Notice ${rendererVersion}";\n`,
  );
  fs.writeFileSync(
    path.join(assets, 'badge.js'),
    `const badge = "lf-menu-build ${rendererVersion}";\n`,
  );
  const archive = path.join(root, 'app.asar');
  await asar.createPackage(source, archive);
  return settled(archive);
}

test('the packaged commercial app carries exactly this release identity and licensing', async () => {
  const packaged = { ...metadata(), author: { name: 'Johann Stolk' } };
  const identity = packaged.kerfdeskCommercialLicense.release;
  const archive = await archiveWith(packaged);
  assert.equal(verifyPackagedCommercialAsar(archive, VERSION, identity, keySets).version, VERSION);
  // Another release's identity, a Preview build or a stale renderer are refused.
  const other = metadata('1.2.4').kerfdeskCommercialLicense.release;
  assert.throws(() => verifyPackagedCommercialAsar(archive, VERSION, other, keySets), /identity/u);
  assert.throws(() => verifyPackagedCommercialAsar(archive, '1.2.4', identity, keySets));
  const preview = await archiveWith({
    version: VERSION,
    author: { name: 'Johann Stolk' },
    kerfdeskDesktopReleaseChannel: 'preview',
    kerfdeskUpdateChannelTrusted: false,
  });
  assert.throws(() => verifyPackagedCommercialAsar(preview, VERSION, identity, keySets));
  const stale = await archiveWith(packaged, '1.2.2');
  assert.throws(() => verifyPackagedCommercialAsar(stale, VERSION, identity, keySets), /renderer/u);
  const stranger = await archiveWith({ ...packaged, author: { name: 'Someone else' } });
  assert.throws(
    () => verifyPackagedCommercialAsar(stranger, VERSION, identity, keySets),
    /author/u,
  );
});
