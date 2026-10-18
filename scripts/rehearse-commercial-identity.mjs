// CI rehearsal of the commercial macOS and Linux builds (ADR-610). The real
// release identity is signed only in the protected Windows job, so a pull
// request cannot build a real commercial package. This replaces the pinned
// stable key in this runner's checkout with a throwaway one and signs a release
// identity with it, so scripts/build-commercial-platform.sh runs exactly as it
// does in a release. The key exists only in this process; nothing it signs can
// be published, because the publishers read the pinned keys of a clean,
// unmodified checkout.
//
// usage: node scripts/rehearse-commercial-identity.mjs <identity.json> <version> <source-sha>

import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KEY_ID = 'stable-rehearsal';

/** The pinned key set with its stable keys replaced by one throwaway key. */
export function rehearsalKeySet(keySet, publicKeySpki) {
  if (keySet?.schemaVersion !== 1 || !Array.isArray(keySet.keys))
    throw new Error('Invalid pinned release key set.');
  return {
    schemaVersion: 1,
    keys: [
      ...keySet.keys.filter((key) => key.channel !== 'stable'),
      { keyId: KEY_ID, algorithm: 'Ed25519', publicKeySpki, channel: 'stable' },
    ],
  };
}

export function rehearsalIdentity({ version, sourceSha, publishedAt }, privateKey) {
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      product: 'kerfdesk-desktop',
      kind: 'release-identity',
      channel: 'stable',
      version,
      sourceSha,
      sourceRef: 'refs/heads/main',
      publishedAt,
    }),
  );
  return {
    schemaVersion: 1,
    keyId: KEY_ID,
    algorithm: 'Ed25519',
    payload: bytes.toString('base64'),
    signature: sign(null, bytes, privateKey).toString('base64'),
  };
}

async function main([identityPath, version, sourceSha, ...extra]) {
  if (!identityPath || !version || !sourceSha || extra.length > 0)
    throw new Error(
      'usage: node scripts/rehearse-commercial-identity.mjs <identity.json> <version> <source-sha>',
    );
  // Only a disposable CI runner may rewrite its pinned keys.
  if (process.env.GITHUB_ACTIONS !== 'true')
    throw new Error('The commercial rehearsal runs only on a CI runner.');
  const keysPath = fileURLToPath(new URL('../public/desktop-release-keys.json', import.meta.url));
  const pair = generateKeyPairSync('ed25519');
  const spki = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const pinned = JSON.parse(await readFile(keysPath, 'utf8'));
  await writeFile(keysPath, `${JSON.stringify(rehearsalKeySet(pinned, spki), null, 2)}\n`);
  const identity = rehearsalIdentity(
    { version, sourceSha, publishedAt: new Date().toISOString() },
    pair.privateKey,
  );
  await writeFile(identityPath, `${JSON.stringify(identity, null, 2)}\n`);
  console.log(`Rehearsal identity for ${version} signed with a throwaway stable key.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
