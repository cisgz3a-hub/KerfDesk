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
  const files = publishedArtifactNames(releaseDir, options.artifactNames);
  const artifacts = files.map((name) => {
    const bytes = fs.readFileSync(path.join(releaseDir, name));
    return {
      name,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  });
  const packageFile = path.resolve(options.packageFile);
  const packageDir = path.dirname(packageFile);
  const rootPackage = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  const dependencyTree = JSON.parse(fs.readFileSync(path.resolve(options.dependencyJson), 'utf8'));
  const components = flattenDependencies(
    dependencyTree,
    rootPackage,
    packageDir,
    options.version,
  ).map(({ name, version, license }) => ({
    SPDXID: `SPDXRef-Package-${sanitizeId(name)}-${sanitizeId(version)}`,
    name,
    versionInfo: version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    // Report the package's declaration, not a legal conclusion from a scan.
    licenseDeclared: license,
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

function flattenDependencies(tree, rootPackage, packageDir, releaseVersion) {
  const roots = Array.isArray(tree) ? tree : [tree];
  const byIdentity = new Map();
  const visit = (node, edgeName, root = false) => {
    if (node === null || typeof node !== 'object')
      throw new Error('Invalid dependency inventory node.');
    const manifest =
      typeof node.path === 'string'
        ? JSON.parse(fs.readFileSync(path.join(node.path, 'package.json'), 'utf8'))
        : root
          ? rootPackage
          : node;
    const name = manifest.name ?? node.name ?? node.from ?? edgeName;
    const version = root ? releaseVersion : (manifest.version ?? node.version);
    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new Error('Dependency inventory entry is missing its name or version.');
    }
    const declared = manifest.license;
    const license = typeof declared === 'string' ? declared : declared?.type;
    const entry = {
      name,
      version,
      license: typeof license === 'string' && license.length > 0 ? license : 'NOASSERTION',
    };
    const key = `${name}@${version}`;
    const previous = byIdentity.get(key);
    if (previous && previous.license !== entry.license) {
      throw new Error(`Dependency variants disagree on the declared license for ${key}.`);
    }
    byIdentity.set(key, entry);
    for (const children of [node.dependencies, node.optionalDependencies]) {
      for (const [childName, child] of Object.entries(children ?? {})) visit(child, childName);
    }
  };
  for (const root of roots) visit(root, rootPackage.name, true);
  // Electron is a devDependency for bundling, but its binary is the installed
  // desktop runtime. Do not confuse its build-time downloader tree with that host.
  if (rootPackage.devDependencies?.electron !== undefined) {
    visit({ path: path.join(packageDir, 'node_modules', 'electron') }, 'electron');
  }
  if (byIdentity.size === 0) throw new Error('Dependency inventory contains no packages.');
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
    // This dependency inventory is a build input for the SBOM. It is not a
    // release asset, so including it would make the published checksum set
    // impossible to close without leaking builder-only metadata.
    name === 'runtime-dependencies.json' ||
    name === 'release-sbom.spdx.json' ||
    name === 'release-provenance.json' ||
    name === 'checksums.sha256'
  );
}

function publishedArtifactNames(releaseDir, artifactNames) {
  if (!Array.isArray(artifactNames) || artifactNames.length === 0) {
    throw new Error('At least one explicit published artifact is required.');
  }
  const uniqueNames = [...new Set(artifactNames)].sort();
  if (uniqueNames.length !== artifactNames.length) {
    throw new Error('Published artifact names must be unique.');
  }
  for (const name of uniqueNames) {
    if (typeof name !== 'string' || name !== path.basename(name) || isGeneratedEvidence(name)) {
      throw new Error(`Invalid published artifact name: ${name}`);
    }
    if (!fs.statSync(path.join(releaseDir, name), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Published artifact does not exist: ${name}`);
    }
  }
  return uniqueNames;
}

const invoked = process.argv[1] === fileURLToPath(import.meta.url);
if (invoked) {
  const required = ['release-dir', 'version', 'source-sha', 'dependency-json', 'package-file'];
  const values = Object.fromEntries(required.map((name) => [name, argument(name)]));
  const missing = required.filter((name) => !values[name]);
  const artifactNames = argumentsFor('artifact');
  if (artifactNames.length === 0) missing.push('artifact');
  if (missing.length > 0) throw new Error(`Missing required arguments: ${missing.join(', ')}`);
  const result = generateReleaseEvidence({
    releaseDir: values['release-dir'],
    version: values.version,
    sourceSha: values['source-sha'],
    dependencyJson: values['dependency-json'],
    packageFile: values['package-file'],
    artifactNames,
    generatedAt: argument('generated-at') ?? new Date().toISOString(),
  });
  console.log(`Release evidence recorded for ${result.artifacts.length} artifacts.`);
}

function argumentsFor(name) {
  const prefix = `--${name}=`;
  return process.argv
    .filter((value) => value.startsWith(prefix))
    .map((value) => value.slice(prefix.length));
}
