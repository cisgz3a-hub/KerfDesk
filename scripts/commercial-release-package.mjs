import { execFile } from 'node:child_process';
import { open, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify, isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { extractFile } from '@electron/asar';
import { JSON_SCHEMA, load } from 'js-yaml';
import { updatePublisherProblems } from './verify-update-publisher.mjs';
import {
  digest,
  stablePublicKeys,
  verifyCommercialEnvelope,
} from './commercial-release-manifest.mjs';
import { verifyCommercialMetadata } from './prepare-commercial-desktop.mjs';

const executeFile = promisify(execFile);
export async function readCommercialInput(path, limit) {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > limit)
      throw new Error('Commercial input file size is invalid.');
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length !== stat.size) throw new Error('Commercial input changed while being read.');
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}
function ownedTemporary(directory) {
  const owned = resolve(directory);
  if (
    dirname(owned) !== resolve(tmpdir()) ||
    !owned.slice(dirname(owned).length + 1).startsWith('kerfdesk-commercial-signature-')
  )
    throw new Error('Signature probe directory escaped the owned temporary root.');
  return owned;
}
export function requireCommercialUpdateConfig(text, expectedPublisher) {
  if (
    typeof expectedPublisher !== 'string' ||
    expectedPublisher.trim() !== expectedPublisher ||
    expectedPublisher.length < 1 ||
    expectedPublisher.length > 500 ||
    /[\r\n\0]/u.test(expectedPublisher)
  )
    throw new Error('Explicit Windows signing publisher is required.');
  if (typeof text !== 'string' || Buffer.byteLength(text) > 16 * 1024)
    throw new Error('Packaged updater config is required.');
  const config = load(text, { schema: JSON_SCHEMA });
  const allowed = new Set(['provider', 'url', 'publisherName', 'updaterCacheDirName']);
  if (!config || typeof config !== 'object' || Object.keys(config).some((key) => !allowed.has(key)))
    throw new Error('Commercial updater config contains unsupported options or credentials.');
  const names =
    typeof config?.publisherName === 'string' ? [config.publisherName] : config?.publisherName;
  if (
    config?.provider !== 'generic' ||
    ![
      'https://dl.kerfdesk.com/desktop/commercial',
      'https://dl.kerfdesk.com/desktop/commercial/',
    ].includes(config.url) ||
    !Array.isArray(names) ||
    names.length !== 1 ||
    typeof names[0] !== 'string' ||
    names[0].trim() === ''
  )
    throw new Error(
      'Commercial updater config must pin the commercial feed and one signing publisher.',
    );
  return config;
}

export function verifyCommercialPackage(metadata, identityEnvelope, keySet, entitlementKeySet) {
  verifyCommercialMetadata(metadata, entitlementKeySet, keySet);
  const identity = verifyCommercialEnvelope(identityEnvelope, keySet, 'release-identity');
  const configured = metadata?.kerfdeskCommercialLicense;
  if (
    metadata?.version !== identity.version ||
    metadata.kerfdeskUpdateChannelTrusted !== true ||
    metadata.kerfdeskDesktopReleaseChannel !== 'stable' ||
    configured?.schema !== 1 ||
    configured.apiOrigin !== 'https://license.kerfdesk.com' ||
    !isDeepStrictEqual(configured.release, identityEnvelope)
  )
    throw new Error('Packaged commercial identity does not match the approved release.');
  if (!isDeepStrictEqual(configured.releaseKeys, stablePublicKeys(keySet)))
    throw new Error(
      'Packaged commercial release keys differ from the independent stable trust anchors.',
    );
  return identity;
}
export async function readCommercialPackage(
  resourcesDirectory,
  identityEnvelope,
  keySet,
  expectedPublisher,
  entitlementKeySet,
) {
  const asar = await readCommercialInput(join(resourcesDirectory, 'app.asar'), 300_000_000);
  const directory = ownedTemporary(await mkdtemp(join(tmpdir(), 'kerfdesk-commercial-signature-')));
  let metadata;
  try {
    const snapshot = join(directory, 'app.asar');
    await writeFile(snapshot, asar, { flag: 'wx' });
    metadata = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(extractFile(snapshot, 'package.json')),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const updateConfigBytes = await readCommercialInput(
    join(resourcesDirectory, 'app-update.yml'),
    16 * 1024,
  );
  const updateConfigText = new TextDecoder('utf-8', { fatal: true }).decode(updateConfigBytes);
  verifyCommercialPackage(metadata, identityEnvelope, keySet, entitlementKeySet);
  requireCommercialUpdateConfig(updateConfigText, expectedPublisher);
  return {
    metadata,
    updateConfigText,
    resourceDigests: [
      { name: 'resources/app.asar', bytes: asar.length, sha256: digest(asar) },
      {
        name: 'resources/app-update.yml',
        bytes: updateConfigBytes.length,
        sha256: digest(updateConfigBytes),
      },
    ],
  };
}

async function builderArchiveTool() {
  const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder'));
  return builderRequire('app-builder-lib/out/toolsets/7zip.js').getPath7za();
}

export async function verifyInstallerResources(
  executable,
  resourceDigests,
  { execute = executeFile, archiveTool = builderArchiveTool } = {},
) {
  const expectedNames = ['resources/app.asar', 'resources/app-update.yml'];
  if (
    !Array.isArray(resourceDigests) ||
    resourceDigests.length !== 2 ||
    !expectedNames.every(
      (name) => resourceDigests.filter((item) => item.name === name).length === 1,
    ) ||
    resourceDigests.some(
      (item) =>
        !Number.isSafeInteger(item.bytes) ||
        item.bytes < 1 ||
        item.bytes > 300_000_000 ||
        !/^[a-f0-9]{64}$/u.test(item.sha256),
    )
  )
    throw new Error('Verified packaged resource digests are mandatory.');
  const tool = await archiveTool();
  for (const expected of resourceDigests) {
    // Stream exactly the named embedded file; no archive path is written to disk.
    // Missing/duplicate entries, oversized output, and a different ASAR all fail.
    const { stdout } = await execute(
      tool,
      ['e', '-so', '-bd', '-y', '--', executable, expected.name],
      { encoding: 'buffer', windowsHide: true, timeout: 120_000, maxBuffer: expected.bytes + 1 },
    );
    if (
      !Buffer.isBuffer(stdout) ||
      stdout.length !== expected.bytes ||
      digest(stdout) !== expected.sha256
    )
      throw new Error(
        `Installer resources do not match the verified commercial package: ${expected.name}`,
      );
  }
}

export function createCommercialInstallerVerifier({
  updateConfigText,
  expectedPublisher,
  resourceDigests,
  execute = executeFile,
  archiveTool = builderArchiveTool,
  io = { mkdtemp, writeFile, rm },
}) {
  requireCommercialUpdateConfig(updateConfigText, expectedPublisher);
  return async (bytes) => {
    const directory = await io.mkdtemp(join(tmpdir(), 'kerfdesk-commercial-signature-'));
    ownedTemporary(directory);
    let failure;
    try {
      const executable = join(directory, 'installer.exe');
      await io.writeFile(executable, bytes);
      const { stdout } = await execute(
        'pwsh',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$ErrorActionPreference = "Stop"; $signature = Get-AuthenticodeSignature -LiteralPath $env:KERFDESK_RELEASE_VERIFY_PATH; if ($signature.Status -ne "Valid" -or $signature.SignatureType -ne "Authenticode" -or [string]::IsNullOrWhiteSpace($signature.SignerCertificate.Subject)) { throw "Commercial installer Authenticode verification failed." }; @{ status = [string]$signature.Status; type = [string]$signature.SignatureType; subject = $signature.SignerCertificate.Subject } | ConvertTo-Json -Compress',
        ],
        {
          env: { ...process.env, KERFDESK_RELEASE_VERIFY_PATH: executable },
          windowsHide: true,
          timeout: 120_000,
          maxBuffer: 16 * 1024,
        },
      );
      const signature = JSON.parse(stdout.trim());
      if (
        signature.status !== 'Valid' ||
        signature.type !== 'Authenticode' ||
        typeof signature.subject !== 'string' ||
        signature.subject.trim() === ''
      )
        throw new Error('Commercial signature verifier returned invalid evidence.');
      const problems = [
        ...updatePublisherProblems(updateConfigText, signature.subject),
        ...updatePublisherProblems(
          JSON.stringify({ publisherName: expectedPublisher }),
          signature.subject,
        ),
      ];
      if (problems.length > 0)
        throw new Error(`Commercial installer publisher mismatch: ${problems.join('; ')}`);
      await verifyInstallerResources(executable, resourceDigests, { execute, archiveTool });
    } catch (error) {
      failure = error;
    }
    try {
      await io.rm(directory, { recursive: true, force: true });
    } catch (error) {
      failure = failure
        ? new AggregateError(
            [failure, error],
            'Signature verification and temporary cleanup failed.',
          )
        : error;
    }
    if (failure) throw failure;
  };
}
