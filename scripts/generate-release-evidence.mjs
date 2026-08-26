import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

export function generateReleaseEvidence(options) {
  const releaseDir = path.resolve(options.releaseDir);
  const files = fs
    .readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !isGeneratedEvidence(entry.name))
    .map((entry) => entry.name)
    .sort();
  const artifacts = files.map((name) => {
    const bytes = fs.readFileSync(path.join(releaseDir, name));
    return {
      name,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  });
  const rootPackage = JSON.parse(fs.readFileSync(path.resolve(options.packageFile), 'utf8'));
  const dependencyTree = JSON.parse(fs.readFileSync(path.resolve(options.dependencyJson), 'utf8'));
  const components = flattenDependencies(dependencyTree).map(({ name, version }) => ({
    SPDXID: `SPDXRef-Package-${sanitizeId(name)}-${sanitizeId(version)}`,
    name,
    versionInfo: version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
  }));
  const sbom = {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `KerfDesk-${options.version}`,
    documentNamespace: `https://kerfdesk.com/spdx/${options.sourceSha}/${options.version}`,
    creationInfo: {
      created: options.generatedAt,
      creators: ['Tool: KerfDesk generate-release-evidence.mjs'],
    },
    packages: components,
  };
  const provenance = {
    schemaVersion: 1,
    generatedAt: options.generatedAt,
    sourceSha: options.sourceSha,
    version: options.version,
    toolchain: {
      node: process.version,
      pnpm: rootPackage.packageManager,
      electron: resolvedPackageVersion('electron'),
      electronBuilder: resolvedPackageVersion('electron-builder'),
      platform: process.platform,
      architecture: process.arch,
    },
    normalizedNondeterminism: [
      'Authenticode signing timestamps are issued externally and are not byte-reproducible.',
      'NSIS container timestamps and compression metadata can vary between build hosts.',
      'Artifact SHA-256 values are therefore release-instance evidence, not a cross-host equality claim.',
    ],
    artifacts,
  };
  fs.writeFileSync(
    path.join(releaseDir, 'release-sbom.spdx.json'),
    `${JSON.stringify(sbom, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(releaseDir, 'release-provenance.json'),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(releaseDir, 'checksums.sha256'),
    `${artifacts.map((artifact) => `${artifact.sha256}  ${artifact.name}`).join('\n')}\n`,
  );
  return { artifacts, sbom, provenance };
}

function flattenDependencies(tree) {
  const roots = Array.isArray(tree) ? tree : [tree];
  const byIdentity = new Map();
  const visit = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (typeof node.name === 'string' && typeof node.version === 'string') {
      byIdentity.set(`${node.name}@${node.version}`, { name: node.name, version: node.version });
    }
    for (const child of Object.values(node.dependencies ?? {})) visit(child);
  };
  for (const root of roots) visit(root);
  return [...byIdentity.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

function resolvedPackageVersion(name) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve('node_modules', name, 'package.json'), 'utf8'))
      .version;
  } catch {
    return 'not-installed';
  }
}

function sanitizeId(value) {
  return value.replace(/[^A-Za-z0-9.-]/gu, '-');
}

function isGeneratedEvidence(name) {
  return (
    name === 'release-sbom.spdx.json' ||
    name === 'release-provenance.json' ||
    name === 'checksums.sha256'
  );
}

const invoked = process.argv[1] === fileURLToPath(import.meta.url);
if (invoked) {
  const required = ['release-dir', 'version', 'source-sha', 'dependency-json', 'package-file'];
  const values = Object.fromEntries(required.map((name) => [name, argument(name)]));
  const missing = required.filter((name) => !values[name]);
  if (missing.length > 0) throw new Error(`Missing required arguments: ${missing.join(', ')}`);
  const result = generateReleaseEvidence({
    releaseDir: values['release-dir'],
    version: values.version,
    sourceSha: values['source-sha'],
    dependencyJson: values['dependency-json'],
    packageFile: values['package-file'],
    generatedAt: argument('generated-at') ?? new Date().toISOString(),
  });
  console.log(`Release evidence recorded for ${result.artifacts.length} artifacts.`);
}
