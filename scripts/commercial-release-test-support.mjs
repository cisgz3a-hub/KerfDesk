import { generateKeyPairSync, sign } from 'node:crypto';
import { digest, stablePublicKeys } from './commercial-release-manifest.mjs';
import { stableArtifactNames } from './stable-release-artifacts.mjs';

const pair = generateKeyPairSync('ed25519');
const entitlementPair = generateKeyPairSync('ed25519');
export const entitlementKeySet = {
  schemaVersion: 1,
  keys: [
    {
      keyId: 'licence-test',
      algorithm: 'Ed25519',
      publicKeySpki: entitlementPair.publicKey
        .export({ format: 'der', type: 'spki' })
        .toString('base64'),
    },
  ],
};
export const keyId = 'stable-test';
export const privateKeyPem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' });
export const keySet = {
  schemaVersion: 1,
  keys: [
    {
      keyId,
      channel: 'stable',
      algorithm: 'Ed25519',
      publicKeySpki: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    },
  ],
};
export const updateConfigText =
  'provider: generic\nurl: https://dl.kerfdesk.com/desktop/commercial/\npublisherName: Example Publisher\n';
export function signed(payload) {
  const bytes = Buffer.from(JSON.stringify(payload));
  return {
    schemaVersion: 1,
    keyId,
    algorithm: 'Ed25519',
    payload: bytes.toString('base64'),
    signature: sign(null, bytes, pair.privateKey).toString('base64'),
  };
}
// A maintainer's tagged release by default; the release train passes
// { sourceRef: 'refs/heads/main' } and its own release time.
export function fixture(
  version = '1.2.3',
  { sourceRef = `refs/tags/v${version}`, publishedAt = '2026-01-01T00:00:00.000Z' } = {},
) {
  const identity = signed({
    schemaVersion: 1,
    product: 'kerfdesk-desktop',
    kind: 'release-identity',
    channel: 'stable',
    version,
    sourceSha: 'a'.repeat(40),
    sourceRef,
    publishedAt,
  });
  const [name, blockmap] = stableArtifactNames(version);
  const bytes = Buffer.from(`signed executable fixture ${version}`);
  const sha512 = digest(bytes, 'sha512');
  const feed = Buffer.from(
    `version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '2026-01-01T00:00:00.000Z'\n`,
  );
  return {
    identity,
    files: [
      { name, bytes },
      { name: blockmap, bytes: Buffer.from('blockmap') },
      { name: 'latest.yml', bytes: feed },
    ],
    metadata: {
      version,
      kerfdeskUpdateChannelTrusted: true,
      kerfdeskDesktopReleaseChannel: 'stable',
      kerfdeskCommercialLicense: {
        schema: 1,
        apiOrigin: 'https://license.kerfdesk.com',
        entitlementKeys: { 'licence-test': entitlementKeySet.keys[0].publicKeySpki },
        releaseKeys: stablePublicKeys(keySet),
        release: identity,
      },
    },
  };
}
export function memoryStore() {
  const objects = new Map();
  const writes = [];
  return {
    objects,
    writes,
    store: {
      async get(key) {
        return objects.has(key) ? Buffer.from(objects.get(key)) : null;
      },
      async put(key, bytes, metadata) {
        writes.push({ key, bytes, metadata });
        objects.set(key, Buffer.from(bytes));
      },
    },
  };
}
export function context(identity) {
  const payload = JSON.parse(Buffer.from(identity.payload, 'base64').toString());
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF_TYPE: 'tag',
    GITHUB_REF: payload.sourceRef,
    GITHUB_REPOSITORY: 'cisgz3a-hub/KerfDesk',
    GITHUB_WORKFLOW_REF: `cisgz3a-hub/KerfDesk/.github/workflows/release-desktop-commercial.yml@${payload.sourceRef}`,
    GITHUB_SHA: payload.sourceSha,
    APPROVED_RELEASE_SHA: payload.sourceSha,
    COMMERCIAL_PUBLICATION_GROUP: 'kerfdesk-commercial-publication',
    DESKTOP_STABLE_MANIFEST_PRIVATE_KEY: privateKeyPem,
    DESKTOP_STABLE_MANIFEST_KEY_ID: keyId,
    COMMERCIAL_R2_API_TOKEN: 'test-token',
    COMMERCIAL_CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    DESKTOP_WINDOWS_PUBLISHER_NAME: 'Example Publisher',
  };
}
