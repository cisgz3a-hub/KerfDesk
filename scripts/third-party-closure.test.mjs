import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildThirdPartyNotice } from './generate-third-party-notices.mjs';
import {
  generateReleaseIntegrity,
  parseArgs as parseReleaseArgs,
} from './generate-release-integrity.mjs';
import {
  OPENCLIPART_ASSETS,
  REPO_ROOT,
  collectElectronPackage,
  collectProductionPackages,
  readPackageLicense,
  verifyOpenClipartAssets,
} from './third-party-closure.mjs';
import { verifyPackagedPreviewMetadata } from './verify-packaged-preview-metadata.mjs';

const packages = collectProductionPackages();
const electronPackage = collectElectronPackage();

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('collects the complete pnpm production closure with the exact reviewed fallback', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.ok(packages.length > Object.keys(packageJson.dependencies).length);
  assert.ok(packages.some(({ name }) => name === 'builder-util-runtime'));
  assert.deepEqual(
    packages
      .filter(({ sourceFiles }) => sourceFiles[0].startsWith('reviewed fallback:'))
      .map(({ name, version }) => `${name}@${version}`),
    ['lazy-val@1.0.5'],
  );
  const dompurify = packages.find(({ name }) => name === 'dompurify');
  assert.deepEqual(dompurify?.sourceFiles, ['LICENSE', 'LICENSE-MPL']);
  assert.equal(electronPackage.license, 'MIT');
  assert.deepEqual(electronPackage.sourceFiles, ['LICENSE']);
});

test('fails closed for a missing package license outside exact lazy-val 1.0.5', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kerfdesk-license-fixture-'));
  try {
    assert.throws(
      () =>
        readPackageLicense({
          depDir: temp,
          license: 'MIT',
          name: 'lazy-val',
          version: '1.0.6',
        }),
      /no LICENSE file found/,
    );
    const fallback = readPackageLicense({
      depDir: temp,
      license: 'MIT',
      name: 'lazy-val',
      version: '1.0.5',
    });
    assert.match(fallback.sourceFiles[0], /reviewed fallback/);
    assert.match(fallback.text, /MIT License/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('pins and verifies all eight OpenClipart assets', () => {
  assert.equal(OPENCLIPART_ASSETS.length, 8);
  assert.equal(verifyOpenClipartAssets().length, 8);
});

test('renders deterministic notices for every production package and artwork asset', () => {
  const first = buildThirdPartyNotice();
  const second = buildThirdPartyNotice();
  assert.equal(second, first);
  assert.doesNotMatch(first, /[ \t]+$/m);
  assert.equal(
    fs.readFileSync(path.join(REPO_ROOT, 'public/third-party-notices.txt'), 'utf8'),
    `${first}\n`,
  );
  assert.equal(countMatches(first, /^--- Package:/gm), packages.length + 1);
  assert.equal(countMatches(first, /^--- Artwork:/gm), 8);
  assert.match(first, /LICENSE\.electron\.txt on Windows; LICENSE on macOS/);
  assert.match(first, /LICENSES\.chromium\.html/);
  assert.match(first, new RegExp(`Package: electron@${electronPackage.version}`));
  for (const dependency of packages) {
    assert.match(first, new RegExp(`Package: ${dependency.name.replace('/', '\\/')}@`));
  }
});

test('writes deterministic checksums, manifest, and CycloneDX SBOM', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kerfdesk-release-integrity-'));
  const artifactsDir = path.join(temp, 'artifacts');
  const outDir = path.join(temp, 'metadata');
  fs.mkdirSync(artifactsDir);
  const artifactPaths = ['windows-x64.exe', 'macos-x64.dmg', 'macos-arm64.dmg'].map(
    (name, index) => {
      const file = path.join(artifactsDir, `KerfDesk-0.2.0-preview.1-${name}`);
      fs.writeFileSync(file, `fixture-${index}\n`);
      return file;
    },
  );
  const args = {
    artifactPaths,
    outDir,
    signerWorkflow: 'cisgz3a-hub/KerfDesk/.github/workflows/release-desktop-preview.yml',
    sourceRef: 'refs/tags/v0.2.0-preview.1',
    sourceRepository: 'cisgz3a-hub/KerfDesk',
    sourceSha: 'a'.repeat(40),
    version: '0.2.0-preview.1',
  };
  try {
    const first = generateReleaseIntegrity(args);
    const firstFiles = Object.values(first.names).map((name) => [
      name,
      fs.readFileSync(path.join(outDir, name), 'utf8'),
    ]);
    const second = generateReleaseIntegrity(args);
    const secondFiles = Object.values(second.names).map((name) => [
      name,
      fs.readFileSync(path.join(outDir, name), 'utf8'),
    ]);
    assert.deepEqual(secondFiles, firstFiles);

    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, second.names.manifest), 'utf8'));
    assert.equal(manifest.artifacts.length, 3);
    assert.equal(manifest.sourceRepository, 'cisgz3a-hub/KerfDesk');
    assert.equal(manifest.sourceSha, 'a'.repeat(40));
    assert.equal(manifest.sourceRef, 'refs/tags/v0.2.0-preview.1');
    assert.equal(manifest.signerWorkflow, args.signerWorkflow);
    assert.equal(manifest.legalClosure.productionNpmComponents, packages.length);
    assert.equal(manifest.legalClosure.electronRuntime.packageVersion, electronPackage.version);
    assert.deepEqual(manifest.legalClosure.electronRuntime.requiredFilesByPlatform, {
      windows: ['LICENSE.electron.txt', 'LICENSES.chromium.html'],
      macos: ['LICENSE', 'LICENSES.chromium.html'],
    });

    const sbom = JSON.parse(fs.readFileSync(path.join(outDir, second.names.sbom), 'utf8'));
    assert.equal(sbom.bomFormat, 'CycloneDX');
    assert.equal(sbom.specVersion, '1.6');
    assert.equal(sbom.components.length, packages.length + 17);

    const checksumLines = fs
      .readFileSync(path.join(outDir, second.names.checksums), 'utf8')
      .trim()
      .split('\n');
    assert.equal(checksumLines.length, 5);
    const checksumTargets = new Map([
      ...artifactPaths.map((file) => [path.basename(file), file]),
      [second.names.manifest, path.join(outDir, second.names.manifest)],
      [second.names.sbom, path.join(outDir, second.names.sbom)],
    ]);
    for (const line of checksumLines) {
      const [, hash, name] = line.match(/^([0-9a-f]{64}) {2}(.+)$/) ?? [];
      assert.equal(hash, sha256File(checksumTargets.get(name)));
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('requires an exact source identity contract on the release CLI', () => {
  const parsed = parseReleaseArgs([
    '--version',
    '0.2.0-preview.1',
    '--source-repository',
    'cisgz3a-hub/KerfDesk',
    '--source-sha',
    'a'.repeat(40),
    '--source-ref',
    'refs/tags/v0.2.0-preview.1',
    '--signer-workflow',
    'cisgz3a-hub/KerfDesk/.github/workflows/release-desktop-preview.yml',
    '--out-dir',
    'release-integrity',
    '--artifact',
    'KerfDesk-0.2.0-preview.1-windows-x64-setup.exe',
  ]);
  assert.equal(parsed.sourceRepository, 'cisgz3a-hub/KerfDesk');
  assert.equal(parsed.sourceRef, 'refs/tags/v0.2.0-preview.1');
  assert.throws(
    () =>
      parseReleaseArgs([
        '--version',
        '0.2.0-preview.1',
        '--source-repository',
        'cisgz3a-hub/KerfDesk',
        '--source-sha',
        'a'.repeat(40),
        '--source-ref',
        'refs/tags/v0.2.0-preview.2',
        '--signer-workflow',
        'cisgz3a-hub/KerfDesk/.github/workflows/release-desktop-preview.yml',
        '--out-dir',
        'release-integrity',
      ]),
    /source-ref must exactly match/,
  );
});

test('requires exact fail-closed metadata inside every packaged Preview', () => {
  const valid = {
    version: '0.2.0-preview.1',
    kerfdeskDesktopReleaseChannel: 'preview',
    kerfdeskUpdateChannelTrusted: false,
  };
  assert.doesNotThrow(() => verifyPackagedPreviewMetadata(valid, valid.version));
  assert.throws(
    () => verifyPackagedPreviewMetadata({ ...valid, version: '0.2.0-preview.2' }, valid.version),
    /version mismatch/,
  );
  assert.throws(
    () =>
      verifyPackagedPreviewMetadata(
        { ...valid, kerfdeskUpdateChannelTrusted: true },
        valid.version,
      ),
    /trust must be exactly false/,
  );
  assert.throws(
    () =>
      verifyPackagedPreviewMetadata(
        { ...valid, kerfdeskDesktopReleaseChannel: 'stable' },
        valid.version,
      ),
    /channel marker is missing/,
  );
});

test('keeps the Preview desktop builder config manual-update only', () => {
  const config = fs.readFileSync(path.join(REPO_ROOT, 'electron-builder.preview.yml'), 'utf8');
  assert.match(config, /\bdmg:\s*\n(?: {2}.+\n)* {2}writeUpdateInfo: false\b/);
  assert.doesNotMatch(config, /\bmac:\s*\n(?: {2}.+\n)* {6}arch:\s*\n/);
  assert.doesNotMatch(config, /\bmac:\s*\n(?: {2}.+\n)* {8}- x64\s*\n(?: {2}.+\n)* {8}- arm64\b/);
});
