#!/usr/bin/env node
/* global AbortSignal, console, fetch, process -- Node 22 runtime; the lint config gives node globals to scripts/ only. */
// Electron download cache for GitHub Actions (ADR-712).
//
//   node electron-downloads.mjs plan      writes the cache key, restore keys and
//                                          folders as step outputs
//   node electron-downloads.mjs prefetch  puts a missing Electron zip into
//                                          @electron/get's cache, retrying with backoff
//
// electron's postinstall and electron-builder both fetch the Electron zip with
// @electron/get into its default cache folder (neither passes a cacheRoot), so
// one restored folder serves both. Setting electron_config_cache would split
// them: electron's postinstall reads it, electron-builder does not.
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const KEY_PREFIX = 'electron-downloads-v1';
// Six attempts over about eight minutes: long enough to ride out a short CDN
// blip, short enough to stay well inside every job's time limit.
export const RETRY_DELAYS_SECONDS = [15, 30, 60, 120, 240];
const RELEASES = 'https://github.com/electron/electron/releases/download';

/** The single locked version of `name` in pnpm-lock.yaml's package keys. */
export function lockedVersion(lockText, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(`^ {2}'?${escaped}@(\\d[^(:'\\s]*)['(:]`, 'gmu');
  const versions = new Set([...lockText.matchAll(pattern)].map((match) => match[1]));
  if (versions.size !== 1) {
    throw new Error(
      `pnpm-lock.yaml must lock exactly one ${name} version; found ${[...versions].join(', ') || 'none'}`,
    );
  }
  return [...versions][0];
}

/** @electron/get's and electron-builder's default cache folders (env-paths rules). */
export function cacheFolders({ platform, env, home }) {
  const local = env.LOCALAPPDATA?.trim();
  const xdg = env.XDG_CACHE_HOME?.trim();
  const builderOverride = env.ELECTRON_BUILDER_CACHE?.trim();
  let electron;
  let builder;
  if (platform === 'win32') {
    const base = local || join(home, 'AppData', 'Local');
    electron = join(base, 'electron', 'Cache');
    builder = join(base, 'electron-builder', 'Cache');
  } else if (platform === 'darwin') {
    electron = join(home, 'Library', 'Caches', 'electron');
    builder = join(home, 'Library', 'Caches', 'electron-builder');
  } else {
    const base = xdg || join(home, '.cache');
    electron = join(base, 'electron');
    builder = join(base, 'electron-builder');
  }
  return { electron, builder: builderOverride ? resolve(builderOverride) : builder };
}

/** The folder @electron/get's Cache.getCacheDirectory picks for a release's files. */
export function releaseCacheDirectory(version) {
  return createHash('sha256').update(`${RELEASES}/v${version}`).digest('hex');
}

/**
 * Cache key, restore keys and folders for one job.
 *
 * Only packaging jobs save. They also keep electron-builder's tools (NSIS,
 * AppImage, fpm, winCodeSign); jobs need different tools, so each keeps its
 * own entry and a job without one starts from another job's entry for the same
 * versions. A job that only installs restores the newest such entry, which
 * holds the Electron zip electron's postinstall needs when the pnpm store
 * cache misses, and saves nothing.
 */
export function cachePlan({
  platform,
  arch,
  electronVersion,
  builderVersion,
  packaging,
  job,
  folders,
}) {
  const shared = `${KEY_PREFIX}-${platform}-${arch}-electron-${electronVersion}-builder-${builderVersion}-`;
  const paths = [folders.electron, folders.builder];
  // The root-certificate keychain electron-builder copies there on macOS is
  // not a download; leave it out.
  if (platform === 'darwin') paths.push(`!${join(folders.builder, '*.keychain')}`);
  return {
    key: packaging ? `${shared}${job}` : `${shared}install-restores-only`,
    restoreKeys: [shared],
    paths,
  };
}

/** SHA-256 of `fileName` in a SHASUMS256.txt body. */
export function checksumFromShasums(text, fileName) {
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/u.exec(line.trim());
    if (match !== null && match[2] === fileName) return match[1];
  }
  throw new Error(`SHASUMS256.txt has no entry for ${fileName}`);
}

export function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function setOutputs(entries) {
  const lines = Object.entries(entries).flatMap(([name, value]) => {
    const delimiter = `EOF_${createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
    return [`${name}<<${delimiter}`, String(value), delimiter];
  });
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${lines.join('\n')}\n`);
  else console.log(lines.join('\n'));
}

function readLock() {
  return readFileSync(resolve(process.cwd(), 'pnpm-lock.yaml'), 'utf8');
}

function plan() {
  const lock = readLock();
  const result = cachePlan({
    platform: process.platform,
    arch: process.arch,
    electronVersion: lockedVersion(lock, 'electron'),
    builderVersion: lockedVersion(lock, 'electron-builder'),
    packaging: process.env.ELECTRON_DOWNLOADS_PACKAGING === 'true',
    job: process.env.ELECTRON_DOWNLOADS_JOB || 'job',
    folders: cacheFolders({ platform: process.platform, env: process.env, home: homedir() }),
  });
  console.log(`Electron download cache key: ${result.key}`);
  setOutputs({
    key: result.key,
    'restore-keys': result.restoreKeys.join('\n'),
    path: result.paths.join('\n'),
  });
}

async function withRetries(label, attempt) {
  for (let index = 0; ; index += 1) {
    try {
      return await attempt();
    } catch (error) {
      const delay = RETRY_DELAYS_SECONDS[index];
      if (error?.retryable !== true || delay === undefined) throw error;
      console.log(`::warning::${label}: ${error.message}; retrying in ${delay} s`);
      await sleep(delay * 1000);
    }
  }
}

async function get(url, timeoutMs) {
  let response;
  try {
    response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw Object.assign(new Error(`${url}: ${error.cause?.code ?? error.name}`), {
      retryable: true,
    });
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error(`${url}: HTTP ${response.status}`), {
      retryable: isRetryableStatus(response.status),
    });
  }
  return response;
}

async function sha256File(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/** The installed electron package's own checksums, when pnpm install has run. */
function installedChecksum(version, fileName) {
  try {
    const dir = join(process.cwd(), 'node_modules', 'electron');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (pkg.version !== version) return undefined;
    return JSON.parse(readFileSync(join(dir, 'checksums.json'), 'utf8'))[fileName];
  } catch {
    return undefined;
  }
}

async function prefetch() {
  const version = lockedVersion(readLock(), 'electron');
  const fileName = `electron-v${version}-${process.platform}-${process.arch}.zip`;
  const folders = cacheFolders({ platform: process.platform, env: process.env, home: homedir() });
  const folder = join(folders.electron, releaseCacheDirectory(version));
  const target = join(folder, fileName);
  const known = installedChecksum(version, fileName);

  if (existsSync(target)) {
    if (known === undefined) {
      // electron's postinstall checks it against its checksums.json and
      // electron-builder against SHASUMS256.txt before either unpacks it.
      console.log(`${fileName} is in the restored cache.`);
      return;
    }
    if ((await sha256File(target)) === known) {
      console.log(`${fileName} is in the restored cache and matches electron's checksums.json.`);
      return;
    }
    console.log(
      `::warning::${fileName} in the cache does not match electron's checksums.json; fetching it again`,
    );
    rmSync(target, { force: true });
  }

  const releaseUrl = `${RELEASES}/v${version}`;
  const expected =
    known ??
    (await withRetries('SHASUMS256.txt', async () => {
      const response = await get(`${releaseUrl}/SHASUMS256.txt`, 60_000);
      return checksumFromShasums(await response.text(), fileName);
    }));

  mkdirSync(folder, { recursive: true });
  const partial = `${target}.partial-${process.pid}`;
  await withRetries(fileName, async () => {
    const response = await get(`${releaseUrl}/${fileName}`, 600_000);
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    } catch (error) {
      rmSync(partial, { force: true });
      throw Object.assign(new Error(`${fileName}: ${error.message}`), { retryable: true });
    }
    const actual = await sha256File(partial);
    if (actual !== expected) {
      rmSync(partial, { force: true });
      throw Object.assign(new Error(`${fileName}: SHA-256 ${actual}, expected ${expected}`), {
        retryable: true,
      });
    }
  });
  renameSync(partial, target);
  console.log(`Fetched ${fileName} into ${dirname(target)} (SHA-256 ${expected}).`);
}

const command = process.argv[2];
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (command === 'plan') {
    plan();
  } else if (command === 'prefetch') {
    prefetch().catch((error) => {
      console.log(
        `::error::Could not fetch Electron from GitHub's release CDN after ${RETRY_DELAYS_SECONDS.length + 1} attempts: ${error.message}. Re-run the job once https://www.githubstatus.com shows downloads have recovered.`,
      );
      process.exit(1);
    });
  } else {
    console.error('usage: electron-downloads.mjs plan|prefetch');
    process.exit(2);
  }
}
