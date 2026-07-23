// Generate deterministic release checksums, a release manifest, and a
// CycloneDX SBOM after all platform artifacts have been downloaded into one
// workflow job. Electron/Chromium licenses remain an artifact-level check.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  CNC_STROKE_FONTS,
  OPENCLIPART_ASSETS,
  OUTLINE_FONTS,
  REPO_ROOT,
  collectElectronPackage,
  collectProductionPackages,
  compareText,
  sha256File,
  verifyOpenClipartAssets,
} from './third-party-closure.mjs';

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

function npmPurl(name, version) {
  if (!name.startsWith('@'))
    return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
  const slash = name.indexOf('/');
  if (slash < 2) throw new Error(`invalid scoped npm package name: ${name}`);
  const namespace = encodeURIComponent(name.slice(0, slash));
  const packageName = encodeURIComponent(name.slice(slash + 1));
  return `pkg:npm/${namespace}/${packageName}@${encodeURIComponent(version)}`;
}

function npmComponents(packages) {
  return packages.map((dependency) => {
    const purl = npmPurl(dependency.name, dependency.version);
    return {
      type: 'library',
      'bom-ref': purl,
      name: dependency.name,
      version: dependency.version,
      scope: 'required',
      licenses: [{ expression: dependency.license }],
      purl,
      ...(dependency.homepage === null
        ? {}
        : { externalReferences: [{ type: 'website', url: dependency.homepage }] }),
      properties: [
        {
          name: 'org.kerfdesk.license.sources',
          value: dependency.sourceFiles.join(', '),
        },
      ],
    };
  });
}

function outlineFontComponents(rootDir) {
  return OUTLINE_FONTS.map((font) => ({
    type: 'file',
    'bom-ref': `urn:kerfdesk:file:${encodeURIComponent(font.file)}`,
    name: font.name,
    scope: 'required',
    hashes: [{ alg: 'SHA-256', content: sha256File(path.join(rootDir, font.file)) }],
    licenses: [{ expression: font.spdx }],
    properties: [{ name: 'org.kerfdesk.bundled.path', value: font.file }],
  }));
}

function cncFontComponents() {
  return CNC_STROKE_FONTS.map((font) => ({
    type: 'file',
    'bom-ref': `urn:kerfdesk:cnc-font:${encodeURIComponent(font.file)}`,
    name: font.name,
    scope: 'required',
    licenses: [{ expression: 'OFL-1.1' }],
    externalReferences: [{ type: 'distribution', url: font.source }],
    properties: [
      { name: 'org.kerfdesk.upstream.file', value: font.file },
      { name: 'org.kerfdesk.upstream.sha256', value: font.sha256 },
    ],
  }));
}

function openClipartComponents(rootDir) {
  verifyOpenClipartAssets(rootDir);
  return OPENCLIPART_ASSETS.map((asset) => ({
    type: 'file',
    'bom-ref': `urn:kerfdesk:file:${encodeURIComponent(asset.file)}`,
    name: asset.name,
    scope: 'required',
    hashes: [{ alg: 'SHA-256', content: asset.sha256 }],
    licenses: [{ expression: 'CC0-1.0' }],
    externalReferences: [{ type: 'distribution', url: asset.source }],
    properties: [{ name: 'org.kerfdesk.bundled.path', value: asset.file }],
  }));
}

export function buildCycloneDx({
  electronPackage,
  packages,
  rootDir = REPO_ROOT,
  signerWorkflow,
  sourceRef,
  sourceRepository,
  sourceSha,
  version,
}) {
  const rootRef = `pkg:generic/KerfDesk@${encodeURIComponent(version)}`;
  const components = [
    ...npmComponents([...packages, electronPackage]),
    ...outlineFontComponents(rootDir),
    ...cncFontComponents(),
    ...openClipartComponents(rootDir),
  ].sort((a, b) => compareText(a['bom-ref'], b['bom-ref']));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        'bom-ref': rootRef,
        name: 'KerfDesk',
        version,
        licenses: [{ expression: 'MIT' }],
      },
      properties: [
        { name: 'org.kerfdesk.source.commit', value: sourceSha },
        { name: 'org.kerfdesk.source.repository', value: sourceRepository },
        { name: 'org.kerfdesk.source.ref', value: sourceRef },
        { name: 'org.kerfdesk.signer.workflow', value: signerWorkflow },
        {
          name: 'org.kerfdesk.closure.scope',
          value: 'pnpm production dependencies, bundled fonts, and OpenClipart assets',
        },
        {
          name: 'org.kerfdesk.electron-runtime-notices',
          value:
            'artifact verification required: Windows LICENSE.electron.txt or macOS LICENSE, plus LICENSES.chromium.html',
        },
      ],
    },
    components,
    dependencies: [
      { ref: rootRef, dependsOn: components.map((component) => component['bom-ref']) },
    ],
  };
}

function artifactRecords(artifactPaths) {
  const names = new Set();
  return [...artifactPaths]
    .map((artifactPath) => {
      const absolute = path.resolve(artifactPath);
      const stat = fs.statSync(absolute);
      if (!stat.isFile()) throw new Error(`release artifact is not a file: ${artifactPath}`);
      const name = path.basename(absolute);
      if (names.has(name)) throw new Error(`duplicate release artifact name: ${name}`);
      names.add(name);
      return { name, bytes: stat.size, sha256: sha256File(absolute) };
    })
    .sort((a, b) => compareText(a.name, b.name));
}

function outputNames(version) {
  const prefix = `KerfDesk-${version}`;
  return {
    checksums: `${prefix}-SHA256SUMS.txt`,
    manifest: `${prefix}-release-manifest.json`,
    sbom: `${prefix}-sbom.cdx.json`,
  };
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateSourceIdentity({
  signerWorkflow,
  sourceRef,
  sourceRepository,
  sourceSha,
  version,
}) {
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(sourceSha ?? '')) {
    throw new Error('--source-sha must be a 40- or 64-character hexadecimal commit id');
  }
  const versionPattern =
    /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z.-]+)?$/;
  if (!versionPattern.test(version ?? '')) {
    throw new Error('--version must be SemVer without a leading v');
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(sourceRepository ?? '')) {
    throw new Error('--source-repository must be an owner/repository slug');
  }
  if (sourceRef !== `refs/tags/v${version}`) {
    throw new Error('--source-ref must exactly match refs/tags/v<version>');
  }
  const expectedWorkflow = `${sourceRepository}/.github/workflows/release-desktop-preview.yml`;
  if (signerWorkflow !== expectedWorkflow) {
    throw new Error(`--signer-workflow must equal ${expectedWorkflow}`);
  }
}

export function generateReleaseIntegrity({
  artifactPaths,
  outDir,
  rootDir = REPO_ROOT,
  signerWorkflow,
  sourceRef,
  sourceRepository,
  sourceSha,
  version,
}) {
  if (!Array.isArray(artifactPaths) || artifactPaths.length === 0) {
    throw new Error('at least one --artifact is required');
  }
  if (typeof outDir !== 'string' || outDir.length === 0) throw new Error('--out-dir is required');
  validateSourceIdentity({ signerWorkflow, sourceRef, sourceRepository, sourceSha, version });
  const artifacts = artifactRecords(artifactPaths);
  const packages = collectProductionPackages(rootDir);
  const electronPackage = collectElectronPackage(rootDir);
  const names = outputNames(version);
  const reservedNames = new Set(Object.values(names));
  const collision = artifacts.find(({ name }) => reservedNames.has(name));
  if (collision !== undefined) {
    throw new Error(`release artifact name collides with generated companion: ${collision.name}`);
  }
  const sbomText = jsonText(
    buildCycloneDx({
      electronPackage,
      packages,
      rootDir,
      signerWorkflow,
      sourceRef,
      sourceRepository,
      sourceSha,
      version,
    }),
  );
  const sbomRecord = {
    name: names.sbom,
    bytes: Buffer.byteLength(sbomText),
    sha256: sha256Text(sbomText),
  };
  const manifest = {
    schemaVersion: 1,
    product: 'KerfDesk',
    version,
    sourceRepository,
    sourceSha,
    sourceRef,
    signerWorkflow,
    artifacts,
    companions: { checksums: names.checksums, sbom: sbomRecord },
    legalClosure: {
      productionNpmComponents: packages.length,
      bundledFonts: OUTLINE_FONTS.length + CNC_STROKE_FONTS.length,
      openClipartAssets: OPENCLIPART_ASSETS.length,
      electronRuntime: {
        status: 'package-notices-required-runtime-bundles-diagnostic',
        packageVersion: electronPackage.version,
        requiredFilesByPlatform: {
          windows: ['LICENSE.electron.txt', 'LICENSES.chromium.html'],
          macos: [],
        },
        diagnosticFilesByPlatform: {
          macos: ['LICENSE', 'LICENSES.chromium.html'],
        },
      },
    },
  };
  const manifestText = jsonText(manifest);
  const manifestRecord = {
    name: names.manifest,
    bytes: Buffer.byteLength(manifestText),
    sha256: sha256Text(manifestText),
  };
  const checksumsText = [...artifacts, manifestRecord, sbomRecord]
    .sort((a, b) => compareText(a.name, b.name))
    .map((record) => `${record.sha256}  ${record.name}`)
    .join('\n');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, names.sbom), sbomText);
  fs.writeFileSync(path.join(outDir, names.manifest), manifestText);
  fs.writeFileSync(path.join(outDir, names.checksums), `${checksumsText}\n`);
  return { artifacts, names, packageCount: packages.length };
}

export function parseArgs(args) {
  const parsed = { artifactPaths: [] };
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (value === undefined) throw new Error(`missing value for ${option}`);
    if (option === '--artifact') parsed.artifactPaths.push(path.resolve(value));
    else if (option === '--out-dir') parsed.outDir = path.resolve(value);
    else if (option === '--signer-workflow') parsed.signerWorkflow = value;
    else if (option === '--source-ref') parsed.sourceRef = value;
    else if (option === '--source-repository') parsed.sourceRepository = value;
    else if (option === '--source-sha') parsed.sourceSha = value.toLowerCase();
    else if (option === '--version') parsed.version = value;
    else throw new Error(`unknown option: ${option}`);
  }
  if (parsed.outDir === undefined) throw new Error('--out-dir is required');
  validateSourceIdentity(parsed);
  return parsed;
}

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = generateReleaseIntegrity(parseArgs(process.argv.slice(2)));
    process.stdout.write(
      `wrote ${Object.values(result.names).join(', ')} (${result.packageCount} npm components)\n`,
    );
  } catch (error) {
    process.stderr.write(`generate-release-integrity: ${error.message}\n`);
    process.exitCode = 1;
  }
}
