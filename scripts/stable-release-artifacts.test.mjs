import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareStableVersions,
  parseStableFeed,
  sha256,
  validateStableRelease,
} from './stable-release-artifacts.mjs';
import { feedOf, releaseFixture } from './stable-release-test-support.mjs';

test('compares numeric SemVer fields without lexical or integer-precision mistakes', () => {
  assert.equal(compareStableVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareStableVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareStableVersions('1.9007199254740993.0', '1.9007199254740992.0'), 1);
  for (const value of ['1.0', '01.0.0', '1.2.3-preview.1', '1.2.3+build', 'v1.2.3']) {
    assert.throws(() => compareStableVersions(value, '1.0.0'), /strict stable/u);
  }
});

test('validates the builder feed and exact checksum/provenance closure', () => {
  const fixture = releaseFixture();
  assert.equal(parseStableFeed(feedOf(fixture)).version, '1.2.3');
  assert.equal(validateStableRelease(fixture).size, 6);
});

test('rejects duplicate keys, broken YAML, wrong installer URLs and malformed feed data', () => {
  const original = feedOf(releaseFixture()).toString('utf8');
  for (const source of [
    `${original}version: 9.0.0\n`,
    `${original}bad: [`,
    'null',
    original.replace('url: KerfDesk-', 'url: https://untrusted.example/KerfDesk-'),
    original.replace('version: 1.2.3', 'version: 1.2.3-preview.1'),
    original.replace(/ {4}size: [0-9]+/u, '    size: -1'),
  ])
    assert.throws(() => parseStableFeed(Buffer.from(source)));
});

test('requires each of the six expected artifact files exactly once', () => {
  const fixture = releaseFixture();
  assert.throws(
    () => validateStableRelease({ ...fixture, files: fixture.files.slice(1) }),
    /six expected/u,
  );
  const repeated = [...fixture.files.slice(1), fixture.files[1]];
  assert.throws(() => validateStableRelease({ ...fixture, files: repeated }), /six expected/u);
});

test('tampered installer, blockmap, checksum, source identity and SBOM are refused', () => {
  for (const fileName of [
    'KerfDesk-1.2.3-windows-x64-setup.exe',
    'KerfDesk-1.2.3-windows-x64-setup.exe.blockmap',
    'checksums.sha256',
    'release-sbom.spdx.json',
  ]) {
    const fixture = releaseFixture();
    fixture.files.find((file) => file.name === fileName).bytes = Buffer.from('tampered');
    assert.throws(() => validateStableRelease(fixture));
  }
  assert.throws(
    () => validateStableRelease({ ...releaseFixture(), sourceSha: 'b'.repeat(40) }),
    /identity mismatch/u,
  );
});

test('requires exactly one SBOM entry in provenance and checksums', () => {
  const sbomName = 'release-sbom.spdx.json';
  for (const duplicate of [false, true]) {
    const provenanceFixture = releaseFixture();
    const provenanceFile = provenanceFixture.files.find(
      ({ name }) => name === 'release-provenance.json',
    );
    const provenance = JSON.parse(provenanceFile.bytes.toString('utf8'));
    provenance.artifacts = duplicate
      ? [...provenance.artifacts, provenance.artifacts.find(({ name }) => name === sbomName)]
      : provenance.artifacts.filter(({ name }) => name !== sbomName);
    provenanceFile.bytes = Buffer.from(JSON.stringify(provenance));
    assert.throws(() => validateStableRelease(provenanceFixture), /artifact set mismatch/u);

    const checksumFixture = releaseFixture();
    const checksumFile = checksumFixture.files.find(({ name }) => name === 'checksums.sha256');
    const lines = checksumFile.bytes.toString('utf8').trimEnd().split('\n');
    const entries = duplicate
      ? [...lines, lines.find((line) => line.endsWith(sbomName))]
      : lines.filter((line) => !line.endsWith(sbomName));
    checksumFile.bytes = Buffer.from(`${entries.join('\n')}\n`);
    assert.throws(() => validateStableRelease(checksumFixture), /checksum manifest mismatch/u);
  }
});

test('checksums independently reject changed SBOM bytes even when provenance agrees', () => {
  const fixture = releaseFixture();
  const sbom = fixture.files.find(({ name }) => name === 'release-sbom.spdx.json');
  const changed = JSON.parse(sbom.bytes.toString('utf8'));
  changed.packages.push({ name: 'unexpected-package', versionInfo: '9.9.9' });
  sbom.bytes = Buffer.from(JSON.stringify(changed));
  const provenanceFile = fixture.files.find(({ name }) => name === 'release-provenance.json');
  const provenance = JSON.parse(provenanceFile.bytes.toString('utf8'));
  Object.assign(
    provenance.artifacts.find(({ name }) => name === sbom.name),
    {
      sha256: sha256(sbom.bytes),
      bytes: sbom.bytes.length,
    },
  );
  provenanceFile.bytes = Buffer.from(JSON.stringify(provenance));
  assert.throws(() => validateStableRelease(fixture), /checksum manifest mismatch/u);
});
