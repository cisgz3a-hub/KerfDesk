import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { isDeepStrictEqual, promisify } from 'node:util';
import { extractFile } from '@electron/asar';
import {
  CommercialReleaseError,
  digest,
  verifyCommercialEnvelope,
} from './commercial-release-manifest.mjs';
import { commercialToolEnvironment, readCommercialInput } from './commercial-release-package.mjs';
import { verifyUnsignedCommercialMetadata } from './prepare-commercial-desktop.mjs';
import { verifyDesktopRendererAsar } from './verify-desktop-renderer.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const executeFile = promisify(execFile);
const NOTICES = [
  ['LICENSE', 'resources/legal/LICENSE'],
  ['THIRD_PARTY_NOTICES.md', 'resources/legal/THIRD_PARTY_NOTICES.md'],
  ['public/third-party-notices.txt', 'resources/legal/third-party-notices.txt'],
];
const NAMES = ['KerfDesk.exe', 'resources/app.asar', ...NOTICES.map(([, name]) => name)];
const NSIS_PAYLOAD = '$PLUGINSDIR/app-64.7z';
const MAX_PAYLOAD_BYTES = 300_000_000;
function requireVerified(condition, message) {
  if (!condition) throw new CommercialReleaseError(message);
}
function ownedTemporary(directory) {
  const owned = resolve(directory);
  requireVerified(
    dirname(owned) === resolve(tmpdir()) &&
      owned.slice(dirname(owned).length + 1).startsWith('kerfdesk-unsigned-package-'),
    'Unsigned verification directory escaped its temporary root.',
  );
  return owned;
}
async function requireNoUpdateConfig(resourcesDirectory) {
  try {
    await stat(join(resourcesDirectory, 'app-update.yml'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new CommercialReleaseError('Unsigned commercial packages cannot contain an update feed.');
}

/** Read actual production package bytes before constructing a manual download manifest. */
export async function readUnsignedCommercialPackage(
  resourcesDirectory,
  identityEnvelope,
  keySet,
  entitlementKeySet,
) {
  await requireNoUpdateConfig(resourcesDirectory);
  const identity = verifyCommercialEnvelope(identityEnvelope, keySet, 'release-identity');
  const asar = await readCommercialInput(join(resourcesDirectory, 'app.asar'), 300_000_000);
  const directory = ownedTemporary(await mkdtemp(join(tmpdir(), 'kerfdesk-unsigned-package-')));
  let metadata;
  try {
    const snapshot = join(directory, 'app.asar');
    await writeFile(snapshot, asar, { flag: 'wx' });
    metadata = JSON.parse(extractFile(snapshot, 'package.json').toString('utf8'));
    verifyUnsignedCommercialMetadata(metadata, entitlementKeySet, keySet);
    requireVerified(
      metadata.version === identity.version &&
        isDeepStrictEqual(metadata.kerfdeskCommercialLicense.release, identityEnvelope),
      'Unsigned packaged identity differs from the approved release.',
    );
    verifyDesktopRendererAsar(snapshot);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const resourceDigests = [
    { name: 'resources/app.asar', bytes: asar.length, sha256: digest(asar) },
  ];
  const executable = await readCommercialInput(
    join(dirname(resourcesDirectory), 'KerfDesk.exe'),
    300_000_000,
  );
  resourceDigests.push({
    name: 'KerfDesk.exe',
    bytes: executable.length,
    sha256: digest(executable),
  });
  for (const [source, name] of NOTICES) {
    const bytes = await readCommercialInput(join(dirname(resourcesDirectory), name), 4_000_000);
    requireVerified(
      bytes.equals(await readFile(join(ROOT, source))),
      `Unsigned commercial legal notice differs: ${source}`,
    );
    resourceDigests.push({ name, bytes: bytes.length, sha256: digest(bytes) });
  }
  return { metadata, resourceDigests };
}

async function builderArchiveTool() {
  const requireBuilder = createRequire(import.meta.resolve('electron-builder'));
  return requireBuilder('app-builder-lib/out/toolsets/7zip.js').getPath7za();
}

async function archiveEntries(tool, execute, archive) {
  const { stdout } = await execute(tool, ['l', '-slt', '-ba', '--', archive], {
    env: commercialToolEnvironment(),
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 4_000_000,
  });
  const entries = [];
  for (const line of stdout.toString().split(/\r?\n/u)) {
    const path = /^Path = (.+)$/u.exec(line);
    if (path) entries.push({ name: path[1].trimEnd().replaceAll('\\', '/'), bytes: null });
    else if (/^Size = \d+$/u.test(line) && entries.length > 0)
      entries.at(-1).bytes = Number(line.slice(7));
  }
  return entries;
}

/** NSIS wraps the x64 app in a 7z payload; write only this exact owned file. */
async function installerApplicationArchive(tool, execute, executable, directory, io) {
  const entries = await archiveEntries(tool, execute, executable);
  requireVerified(
    !entries.some(({ name }) => /(^|\/)app-update\.yml$/iu.test(name)),
    'Unsigned installer contains an update feed.',
  );
  const payloads = entries.filter(({ name }) =>
    /^\$PLUGINSDIR\/app-[^/]+\.(?:7z|zip)$/iu.test(name),
  );
  const payload = payloads[0];
  requireVerified(
    payloads.length === 1 && payload.name === NSIS_PAYLOAD,
    'Unsigned installer must contain one embedded Windows x64 application archive.',
  );
  requireVerified(
    Number.isSafeInteger(payload.bytes) && payload.bytes > 0 && payload.bytes <= MAX_PAYLOAD_BYTES,
    'Unsigned installer application archive size is invalid.',
  );
  const { stdout } = await execute(
    tool,
    ['e', '-so', '-bd', '-y', '--', executable, NSIS_PAYLOAD],
    {
      encoding: 'buffer',
      env: commercialToolEnvironment(),
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: payload.bytes + 1,
    },
  );
  requireVerified(
    Buffer.isBuffer(stdout) && stdout.length === payload.bytes,
    'Unsigned installer application archive size differs from its listing.',
  );
  const archive = join(directory, 'app-64.7z');
  await io.writeFile(archive, stdout, { flag: 'wx' });
  return archive;
}

/** Do not execute the installer. Read its archive and Authenticode status only. */
export function createUnsignedCommercialInstallerVerifier({
  resourceDigests,
  execute = executeFile,
  archiveTool = builderArchiveTool,
  io = { mkdtemp, writeFile, rm },
}) {
  requireVerified(
    Array.isArray(resourceDigests) &&
      resourceDigests.length === NAMES.length &&
      NAMES.every((name) => resourceDigests.filter((item) => item.name === name).length === 1) &&
      resourceDigests.every(
        (item) =>
          Number.isSafeInteger(item.bytes) &&
          item.bytes > 0 &&
          item.bytes <= 300_000_000 &&
          /^[a-f0-9]{64}$/u.test(item.sha256),
      ),
    'Verified unsigned packaged resource digests are mandatory.',
  );
  return async (bytes) => {
    requireVerified(
      Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 300_000_000,
      'Unsigned installer bytes are invalid.',
    );
    const directory = ownedTemporary(
      await io.mkdtemp(join(tmpdir(), 'kerfdesk-unsigned-package-')),
    );
    try {
      const executable = join(directory, 'installer.exe');
      await io.writeFile(executable, bytes, { flag: 'wx' });
      const signature = await execute(
        'pwsh',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$ErrorActionPreference = "Stop"; $signature = Get-AuthenticodeSignature -LiteralPath $env:KERFDESK_RELEASE_VERIFY_PATH; @{ status = [string]$signature.Status } | ConvertTo-Json -Compress',
        ],
        {
          env: commercialToolEnvironment({ KERFDESK_RELEASE_VERIFY_PATH: executable }),
          windowsHide: true,
          timeout: 120_000,
          maxBuffer: 16_384,
        },
      );
      requireVerified(
        JSON.parse(signature.stdout.toString().trim()).status === 'NotSigned',
        'Manual unsigned installer has an unexpected Authenticode status.',
      );
      const tool = await archiveTool();
      const archive = await installerApplicationArchive(tool, execute, executable, directory, io);
      const names = (await archiveEntries(tool, execute, archive)).map(({ name }) => name);
      requireVerified(
        !names.some((name) => /(^|\/)app-update\.yml$/iu.test(name)) &&
          NAMES.every((name) => names.filter((entry) => entry === name).length === 1),
        'Unsigned installer contains an update feed or missing/duplicate required resources.',
      );
      for (const expected of resourceDigests) {
        const { stdout } = await execute(
          tool,
          ['e', '-so', '-bd', '-y', '--', archive, expected.name],
          {
            encoding: 'buffer',
            env: commercialToolEnvironment(),
            windowsHide: true,
            timeout: 120_000,
            maxBuffer: expected.bytes + 1,
          },
        );
        requireVerified(
          Buffer.isBuffer(stdout) &&
            stdout.length === expected.bytes &&
            digest(stdout) === expected.sha256,
          `Unsigned installer differs from verified package: ${expected.name}`,
        );
      }
    } finally {
      await io.rm(directory, { recursive: true, force: true });
    }
  };
}
