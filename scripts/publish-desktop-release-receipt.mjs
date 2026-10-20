import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { open } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { manualDownloadKey } from '../public/desktop-manual-download.mjs';
import {
  CommercialReleaseError,
  digest,
  printableRefusal,
  verifyCommercialEnvelope,
} from './commercial-release-manifest.mjs';
import { releaseReceiptContext, retainReleaseReceipt } from './desktop-release-receipt.mjs';
import { createStableReleaseStore, printableStorageFailure } from './stable-release-store.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const USAGE =
  'Usage: publish-desktop-release-receipt.mjs --identity <json> --installer <exe> --launch <qualification.json> --asar-restoration <json> --dependency-audit <report.json> --public-delivery <json> (--upgrade <qualification.json> --previous-manifest <json> | --first-release)';
const refuse = (condition, message = USAGE) => {
  if (!condition) throw new CommercialReleaseError(message);
};

export function parseReceiptArguments(args) {
  const names = new Map([
    ['--identity', 'identity'],
    ['--installer', 'installer'],
    ['--launch', 'launch'],
    ['--upgrade', 'upgrade'],
    ['--previous-manifest', 'previousManifest'],
    ['--asar-restoration', 'restoration'],
    ['--dependency-audit', 'dependencyAudit'],
    ['--public-delivery', 'delivery'],
  ]);
  const paths = {};
  let firstRelease = false;
  for (let at = 0; at < args.length; ) {
    if (args[at] === '--first-release') {
      refuse(!firstRelease);
      firstRelease = true;
      at += 1;
      continue;
    }
    const name = names.get(args[at]);
    const value = args[at + 1];
    refuse(name && value && !value.startsWith('--') && !Object.hasOwn(paths, name));
    paths[name] = value;
    at += 2;
  }
  refuse(
    ['identity', 'installer', 'launch', 'restoration', 'dependencyAudit', 'delivery'].every(
      (key) => paths[key],
    ),
  );
  refuse(
    firstRelease
      ? !paths.upgrade && !paths.previousManifest
      : paths.upgrade && paths.previousManifest,
  );
  return { paths, firstRelease };
}

async function boundedFile(path, limit = 2 * 1024 * 1024) {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    refuse(
      stat.isFile() && stat.size > 0 && stat.size <= limit,
      'Receipt input is not a bounded regular file.',
    );
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await handle.read(bytes, size, bytes.length - size, null);
      if (result.bytesRead === 0) break;
      size += result.bytesRead;
    }
    refuse(size === stat.size, 'Receipt input changed during reading.');
    return bytes.subarray(0, size);
  } finally {
    await handle.close();
  }
}

async function installerDigest(path) {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    refuse(
      stat.isFile() && stat.size > 0 && stat.size <= 300_000_000,
      'Installer is not a bounded regular file.',
    );
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      refuse(bytes <= stat.size, 'Installer changed during reading.');
      hash.update(chunk);
    }
    refuse(bytes === stat.size, 'Installer changed during reading.');
    return { name: basename(path), bytes, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
  }
}

export async function runReceiptPublication(args, env = process.env) {
  const { paths, firstRelease } = parseReceiptArguments(args);
  const json = (bytes) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const keySet = json(
    await boundedFile(new URL('../public/desktop-release-keys.json', import.meta.url), 16_384),
  );
  const identity = json(await boundedFile(paths.identity, 65_536));
  const release = verifyCommercialEnvelope(identity, keySet, 'release-identity');
  const context = releaseReceiptContext(env, release.sourceSha);
  refuse(
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() ===
      release.sourceSha,
    'Receipt checkout does not match the release candidate.',
  );
  refuse(
    typeof env.DESKTOP_STABLE_MANIFEST_PRIVATE_KEY === 'string' &&
      env.DESKTOP_STABLE_MANIFEST_PRIVATE_KEY.trim() &&
      typeof env.DESKTOP_STABLE_MANIFEST_KEY_ID === 'string',
    'Protected stable signing configuration is required.',
  );
  const evidence = {};
  for (const name of ['launch', 'upgrade', 'restoration', 'dependencyAudit', 'delivery'])
    if (paths[name]) evidence[name] = json(await boundedFile(paths[name]));
  const installer = await installerDigest(paths.installer);
  const previousManifest = paths.previousManifest
    ? await boundedFile(paths.previousManifest, 65_536)
    : undefined;
  const lockfileSha256 = digest(
    await boundedFile(new URL('../pnpm-lock.yaml', import.meta.url), 4 * 1024 * 1024),
  );
  const store = await createStableReleaseStore({
    accountId: env.COMMERCIAL_CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.COMMERCIAL_R2_API_TOKEN,
  });
  const manifest = await store.get(manualDownloadKey(release.version, 'download-manifest.json'));
  return retainReleaseReceipt({
    identity,
    installer,
    keySet,
    context,
    ...evidence,
    previousManifest,
    firstRelease,
    lockfileSha256,
    manifest,
    store,
    keyId: env.DESKTOP_STABLE_MANIFEST_KEY_ID,
    privateKeyPem: env.DESKTOP_STABLE_MANIFEST_PRIVATE_KEY,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runReceiptPublication(process.argv.slice(2))
    .then((result) => {
      console.log(
        `Release success evidence ${result.status}: ${result.key}; SHA-256 ${result.sha256}.`,
      );
    })
    .catch((error) => {
      console.error(
        printableStorageFailure(error) ??
          printableRefusal(error) ??
          'Release success evidence could not be retained.',
      );
      process.exitCode = 1;
    });
