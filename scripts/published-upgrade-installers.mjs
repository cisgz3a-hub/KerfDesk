import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  MANUAL_DOWNLOAD_LIMIT,
  manualDownloadUrl,
  verifyManualDownload,
} from '../public/desktop-manual-download.mjs';
import { commercialArtifactNames } from '../public/desktop-commercial-catalog.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const execute = promisify(execFile);

export async function boundedPublishedBytes(response, limit) {
  if (response.status !== 200 || !response.body) throw new Error('Public release fetch failed.');
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit))
    throw new Error('Public release declared size exceeds its limit.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Public release response exceeds its limit.');
    chunks.push(chunk);
  }
  if (!size || (declared !== null && Number(declared) !== size))
    throw new Error('Public release size is incomplete.');
  return Buffer.concat(chunks);
}

export async function authenticatePublishedInstaller(manifestText, version, keySet, bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error('Public installer must be verified byte data.');
  const manifest = await verifyManualDownload(manifestText, keySet);
  if (manifest.version !== version) throw new Error('Public release version differs from request.');
  const artifact = manifest.artifacts[0];
  if (bytes.length !== artifact.bytes || digest(bytes) !== artifact.sha256)
    throw new Error('Public installer differs from its signed size or SHA-256.');
  return manifest;
}

/** Read immutable releases only. Never update a feed, publish or execute an installer. */
export async function preparePublishedUpgradeInstaller(version, outputRoot) {
  const [name] = commercialArtifactNames(version);
  if (!isAbsolute(outputRoot)) throw new Error('Published installer output must be absolute.');
  const output = join(resolve(outputRoot), version);
  await mkdir(resolve(outputRoot), { recursive: true });
  await mkdir(output); // A retry must use new evidence, never overwrite an older candidate.
  const keySet = JSON.parse(
    await readFile(new URL('../public/desktop-release-keys.json', import.meta.url)),
  );
  const fetchFile = async (url, limit) =>
    boundedPublishedBytes(
      await fetch(url, {
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(180_000),
      }),
      limit,
    );
  const manifestUrl = manualDownloadUrl(version, 'download-manifest.json');
  const manifestBytes = await fetchFile(manifestUrl, MANUAL_DOWNLOAD_LIMIT);
  const manifestText = manifestBytes.toString('utf8');
  const identity = await verifyManualDownload(manifestText, keySet);
  if (identity.version !== version) throw new Error('Public release version differs from request.');
  await writeFile(join(output, 'download-manifest.json'), manifestBytes, { flag: 'wx' });
  const installerUrl = manualDownloadUrl(version, name);
  const installerBytes = await fetchFile(installerUrl, identity.artifacts[0].bytes);
  const manifest = await authenticatePublishedInstaller(
    manifestText,
    version,
    keySet,
    installerBytes,
  );
  const installer = join(output, name);
  await writeFile(installer, installerBytes, { flag: 'wx' });
  const requireBuilder = createRequire(import.meta.resolve('electron-builder'));
  const tool = await requireBuilder('app-builder-lib/out/toolsets/7zip.js').getPath7za();
  const unpacked = join(output, 'win-unpacked');
  await mkdir(unpacked);
  const listing = await execute(tool, ['l', '-slt', '-ba', '--', installer], {
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 4_000_000,
  });
  const names = [...listing.stdout.matchAll(/^Path = (.+)\r?$/gmu)].map(([, value]) =>
    value.trimEnd().replaceAll('\\', '/'),
  );
  if (
    names.some((value) => /^(?:\/|[A-Za-z]:)|(?:^|\/)\.\.(?:\/|$)/u.test(value)) ||
    names.filter((value) => value === 'resources/app.asar').length !== 1 ||
    names.filter((value) => value === 'KerfDesk.exe').length !== 1
  )
    throw new Error('Historical installer archive paths are unsafe or unsupported.');
  const extracted = await execute(tool, ['x', '-bd', '-y', `-o${unpacked}`, '--', installer], {
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 4_000_000,
  });
  await writeFile(join(output, 'archive-listing.txt'), listing.stdout, { flag: 'wx' });
  await writeFile(join(output, 'archive-extraction.txt'), extracted.stdout, { flag: 'wx' });
  const { verifyHistoricalInstalledResources } = await import('./verify-historical-installed.mjs');
  await verifyHistoricalInstalledResources(
    join(unpacked, 'resources'),
    version,
    manifest.sourceSha,
  );
  const receipt = {
    schemaVersion: 1,
    retrievedAt: new Date().toISOString(),
    manifestUrl,
    installerUrl,
    manifestSha256: digest(manifestBytes),
    signatureVerified: true,
    installerHashVerified: true,
    manifest,
    installer,
    unpacked,
    installerExecuted: false,
  };
  await writeFile(join(output, 'public-release.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
  });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [version, output, ...extra] = process.argv.slice(2);
  if (!version || !output || extra.length)
    throw new Error('Expected version and absolute output root.');
  console.log(JSON.stringify(await preparePublishedUpgradeInstaller(version, output)));
}
