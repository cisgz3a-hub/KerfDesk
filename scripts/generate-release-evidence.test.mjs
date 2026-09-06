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

test('reads pnpm keyed dependency nodes and installed license facts, including nested and optional packages', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kerfdesk-pnpm-sbom-'));
  const writePackage = (dir, manifest) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
    return dir;
  };
  writePackage(root, {
    name: 'laserforge',
    version: '0.1.0',
    license: 'MIT',
    devDependencies: { electron: '^40.0.0' },
  });
  const react = writePackage(path.join(root, 'react'), {
    name: 'react',
    version: '18.3.1',
    license: 'MIT',
  });
  const nested = writePackage(path.join(root, 'nested'), {
    name: 'nested',
    version: '1.0.0',
    license: { type: 'ISC' },
  });
  const optional = writePackage(path.join(root, 'optional'), {
    name: 'optional',
    version: '2.0.0',
  });
  writePackage(path.join(root, 'node_modules', 'electron'), {
    name: 'electron',
    version: '40.0.0',
    license: 'MIT',
  });
  const dependencyFile = path.join(root, 'runtime-dependencies.json');
  fs.writeFileSync(
    dependencyFile,
    JSON.stringify([
      {
        name: 'laserforge',
        version: '0.1.0',
        path: root,
        dependencies: {
          'react-alias': {
            from: 'react',
            version: '18.3.1',
            path: react,
            dependencies: { nested: { from: 'nested', version: '1.0.0', path: nested } },
          },
        },
        optionalDependencies: { optional: { from: 'optional', version: '2.0.0', path: optional } },
      },
    ]),
  );
  const releaseDir = path.join(root, 'release');
  fs.mkdirSync(releaseDir);
  fs.writeFileSync(path.join(releaseDir, 'installer.exe'), 'fixture');
  const result = generateReleaseEvidence({
    releaseDir,
    version: '1.2.3',
    sourceSha: 'a'.repeat(40),
    dependencyJson: dependencyFile,
    packageFile: path.join(root, 'package.json'),
    artifactNames: ['installer.exe'],
    generatedAt: '2026-09-06T00:00:00.000Z',
  });
  assert.deepEqual(
    result.sbom.packages.map(({ name, versionInfo, licenseDeclared }) => ({
      name,
      versionInfo,
      licenseDeclared,
    })),
    [
      { name: 'electron', versionInfo: '40.0.0', licenseDeclared: 'MIT' },
      { name: 'laserforge', versionInfo: '1.2.3', licenseDeclared: 'MIT' },
      { name: 'nested', versionInfo: '1.0.0', licenseDeclared: 'ISC' },
      { name: 'optional', versionInfo: '2.0.0', licenseDeclared: 'NOASSERTION' },
      { name: 'react', versionInfo: '18.3.1', licenseDeclared: 'MIT' },
    ],
  );
  assert.ok(result.sbom.packages.every((entry) => entry.licenseConcluded === 'NOASSERTION'));
});
