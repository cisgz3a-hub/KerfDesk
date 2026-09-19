import { createHash } from 'node:crypto';
import {
  sha256,
  stableArtifactNames,
  STABLE_DOWNLOAD_KEY,
  STABLE_FEED_KEY,
} from './stable-release-artifacts.mjs';

export function releaseFixture(
  version = '1.2.3',
  installer = `signed installer fixture ${version}`,
) {
  const names = stableArtifactNames(version);
  const executable = Buffer.from(installer);
  const hash = createHash('sha512').update(executable).digest('base64');
  const feed = Buffer.from(
    [
      `version: ${version}`,
      'files:',
      `  - url: ${names[0]}`,
      `    sha512: ${hash}`,
      `    size: ${executable.length}`,
      `path: ${names[0]}`,
      `sha512: ${hash}`,
      "releaseDate: '2026-09-12T00:00:00.000Z'",
      '',
    ].join('\n'),
  );
  const files = [
    { name: names[0], bytes: executable },
    { name: names[1], bytes: Buffer.from('blockmap fixture') },
    { name: 'latest.yml', bytes: feed },
  ];
  const sourceSha = 'a'.repeat(40);
  const sbom = {
    name: 'release-sbom.spdx.json',
    bytes: Buffer.from(JSON.stringify({ spdxVersion: 'SPDX-2.3', packages: [] })),
  };
  const artifacts = [...files, sbom].map(({ name, bytes }) => ({
    name,
    bytes: bytes.length,
    sha256: sha256(bytes),
  }));
  files.push(
    {
      name: 'checksums.sha256',
      bytes: Buffer.from(
        `${artifacts
          .map(({ name, sha256: hash }) => `${hash}  ${name}`)
          .sort()
          .join('\n')}\n`,
      ),
    },
    sbom,
    {
      name: 'release-provenance.json',
      bytes: Buffer.from(JSON.stringify({ version, sourceSha, artifacts })),
    },
  );
  return { version, sourceSha, files };
}

export function memoryStore(previousVersion = null) {
  const objects = new Map();
  if (previousVersion !== null) {
    const previous = releaseFixture(previousVersion);
    objects.set(STABLE_FEED_KEY, feedOf(previous));
    objects.set(`desktop/${previous.files[0].name}`, previous.files[0].bytes);
    objects.set(STABLE_DOWNLOAD_KEY, previous.files[0].bytes);
  }
  const writes = [];
  const store = {
    async get(key) {
      return objects.has(key) ? Buffer.from(objects.get(key)) : null;
    },
    async put(key, bytes, metadata) {
      writes.push({ key, bytes: Buffer.from(bytes), metadata });
      objects.set(key, Buffer.from(bytes));
    },
  };
  return { store, objects, writes };
}

export function feedOf(release) {
  return release.files.find((file) => file.name === 'latest.yml').bytes;
}

export function validContext() {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF_TYPE: 'tag',
    GITHUB_REF: 'refs/tags/v1.2.3',
    GITHUB_REPOSITORY: 'cisgz3a-hub/KerfDesk',
    GITHUB_WORKFLOW_REF:
      'cisgz3a-hub/KerfDesk/.github/workflows/release-desktop-stable.yml@refs/tags/v1.2.3',
    GITHUB_SHA: 'a'.repeat(40),
    APPROVED_RELEASE_SHA: 'a'.repeat(40),
    STABLE_PUBLICATION_GROUP: 'kerfdesk-stable-publication',
  };
}
