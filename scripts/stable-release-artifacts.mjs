import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JSON_SCHEMA, load } from 'js-yaml';

const STABLE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
export const STABLE_FEED_KEY = 'desktop/latest.yml';
export const STABLE_DOWNLOAD_KEY = 'desktop/kerfdesk-latest-x64-setup.exe';

export function stableVersionParts(version) {
  if (typeof version !== 'string' || version.length > 100 || !STABLE_VERSION.test(version)) {
    throw new Error('A strict stable version is required.');
  }
  return version.split('.').map(BigInt);
}

export function compareStableVersions(left, right) {
  const leftParts = stableVersionParts(left);
  const rightParts = stableVersionParts(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index])
      return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

export function parseStableFeed(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 64 * 1024) {
    throw new Error('Stable feed is missing or too large.');
  }
  // JSON schema avoids YAML timestamp/coercion surprises; duplicate keys fail.
  const feed = load(bytes.toString('utf8'), { schema: JSON_SCHEMA });
  if (feed === null || typeof feed !== 'object') throw new Error('Invalid stable feed.');
  const name = stableArtifactNames(feed.version)[0];
  if (
    !Array.isArray(feed.files) ||
    feed.files.length !== 1 ||
    feed.files[0] === null ||
    typeof feed.files[0] !== 'object'
  )
    throw new Error('Invalid stable feed file set.');
  const file = feed.files[0];
  if (
    file.url !== name ||
    feed.path !== name ||
    file.sha512 !== feed.sha512 ||
    !/^[A-Za-z0-9+/]{86}==$/u.test(file.sha512 ?? '')
  )
    throw new Error('Invalid stable feed file identity.');
  if (
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    typeof feed.releaseDate !== 'string' ||
    !Number.isFinite(Date.parse(feed.releaseDate))
  )
    throw new Error('Invalid stable feed file size or release date.');
  return feed;
}

export function stableFeedVersion(bytes) {
  return parseStableFeed(bytes).version;
}

export function validateFeedInstaller(feed, bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    feed.files[0].size !== bytes.length ||
    feed.sha512 !== createHash('sha512').update(bytes).digest('base64')
  )
    throw new Error('Stable feed installer hash mismatch.');
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function stableArtifactNames(version) {
  stableVersionParts(version);
  const executable = `KerfDesk-${version}-windows-x64-setup.exe`;
  return [executable, `${executable}.blockmap`, 'latest.yml'];
}

export async function loadStableRelease(releaseDir, version, sourceSha) {
  const names = [
    ...stableArtifactNames(version),
    'checksums.sha256',
    'release-sbom.spdx.json',
    'release-provenance.json',
  ];
  const files = [];
  for (const name of names) files.push({ name, bytes: await readFile(join(releaseDir, name)) });
  const release = { version, sourceSha, files };
  validateStableRelease(release);
  return release;
}

export function validateStableRelease(release) {
  const artifacts = stableArtifactNames(release.version);
  if (!/^[0-9a-f]{40}$/u.test(release.sourceSha)) throw new Error('Invalid release source SHA.');
  const expected = [
    ...artifacts,
    'checksums.sha256',
    'release-sbom.spdx.json',
    'release-provenance.json',
  ];
  if (
    release.files.length !== expected.length ||
    new Set(release.files.map((file) => file.name)).size !== expected.length
  ) {
    throw new Error('Stable release must contain exactly the six expected files.');
  }
  const files = new Map(release.files.map((file) => [file.name, file.bytes]));
  for (const name of expected) {
    if (!Buffer.isBuffer(files.get(name)) || files.get(name).length === 0)
      throw new Error(`Missing release bytes: ${name}`);
  }
  const feed = parseStableFeed(files.get('latest.yml'));
  if (feed.version !== release.version) throw new Error('Release feed version mismatch.');
  validateFeedInstaller(feed, files.get(artifacts[0]));
  const provenance = JSON.parse(files.get('release-provenance.json').toString('utf8'));
  if (provenance.sourceSha !== release.sourceSha || provenance.version !== release.version)
    throw new Error('Release provenance identity mismatch.');
  const inventory = provenance.artifacts;
  if (!Array.isArray(inventory) || inventory.length !== artifacts.length)
    throw new Error('Release provenance artifact set mismatch.');
  for (const name of artifacts) {
    const entries = inventory.filter((entry) => entry.name === name);
    if (
      entries.length !== 1 ||
      entries[0].sha256 !== sha256(files.get(name)) ||
      entries[0].bytes !== files.get(name).length
    )
      throw new Error(`Release provenance hash mismatch: ${name}`);
  }
  const checksums = files.get('checksums.sha256').toString('utf8').trimEnd().split(/\r?\n/u).sort();
  const expectedChecksums = artifacts.map((name) => `${sha256(files.get(name))}  ${name}`).sort();
  if (JSON.stringify(checksums) !== JSON.stringify(expectedChecksums))
    throw new Error('Release checksum manifest mismatch.');
  const sbom = JSON.parse(files.get('release-sbom.spdx.json').toString('utf8'));
  if (sbom.spdxVersion !== 'SPDX-2.3' || !Array.isArray(sbom.packages))
    throw new Error('Invalid release SBOM.');
  return files;
}
