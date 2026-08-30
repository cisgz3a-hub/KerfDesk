import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateReleaseEvidence } from './generate-release-evidence.mjs';

test('emits deterministic checksums, SPDX inventory, and exact toolchain provenance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kerfdesk-release-evidence-'));
  const releaseDir = path.join(root, 'release');
  fs.mkdirSync(releaseDir);
  fs.writeFileSync(path.join(releaseDir, 'KerfDesk.exe'), 'fixture-installer');
  fs.writeFileSync(path.join(releaseDir, 'KerfDesk.exe.blockmap'), 'fixture-blockmap');
  fs.writeFileSync(path.join(releaseDir, 'latest.yml'), 'version: 1.2.3');
  fs.writeFileSync(path.join(releaseDir, 'builder-debug.yml'), 'builder-only');
  fs.writeFileSync(
    path.join(releaseDir, 'runtime-dependencies.json'),
    JSON.stringify([{ name: 'laserforge', version: '1.2.3' }]),
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ packageManager: 'pnpm@11.3.0' }),
  );
  fs.writeFileSync(
    path.join(root, 'dependencies.json'),
    JSON.stringify([
      {
        name: 'laserforge',
        version: '1.2.3',
        dependencies: { react: { name: 'react', version: '18.3.1' } },
      },
    ]),
  );
  const result = generateReleaseEvidence({
    releaseDir,
    version: '1.2.3',
    sourceSha: 'a'.repeat(40),
    dependencyJson: path.join(root, 'dependencies.json'),
    packageFile: path.join(root, 'package.json'),
    artifactNames: ['KerfDesk.exe', 'KerfDesk.exe.blockmap', 'latest.yml'],
    generatedAt: '2026-08-26T00:00:00.000Z',
  });
  assert.deepEqual(
    result.artifacts.map((artifact) => artifact.name),
    ['KerfDesk.exe', 'KerfDesk.exe.blockmap', 'latest.yml'],
  );
  assert.equal(result.provenance.toolchain.pnpm, 'pnpm@11.3.0');
  assert.ok(result.sbom.packages.some((entry) => entry.name === 'react'));
  assert.match(
    fs.readFileSync(path.join(releaseDir, 'checksums.sha256'), 'utf8'),
    /^[0-9a-f]{64} {2}KerfDesk\.exe\n[0-9a-f]{64} {2}KerfDesk\.exe\.blockmap\n[0-9a-f]{64} {2}latest\.yml\n$/u,
  );
});

test('fails closed when a declared published artifact is absent', () => {
  const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kerfdesk-release-evidence-missing-'));
  assert.throws(
    () =>
      generateReleaseEvidence({
        releaseDir,
        version: '1.2.3',
        sourceSha: 'a'.repeat(40),
        dependencyJson: path.join(releaseDir, 'dependencies.json'),
        packageFile: path.join(releaseDir, 'package.json'),
        artifactNames: ['missing.exe'],
        generatedAt: '2026-08-26T00:00:00.000Z',
      }),
    /Published artifact does not exist/u,
  );
});
