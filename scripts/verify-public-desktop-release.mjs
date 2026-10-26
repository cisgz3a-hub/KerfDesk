// Public CDN and rendered-website evidence. GET only: never publishes or executes an installer.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { commercialArtifactNames } from '../public/desktop-commercial-catalog.mjs';
import {
  MANUAL_DOWNLOAD_LATEST_URL,
  MANUAL_DOWNLOAD_LIMIT,
  manualDownloadUrl,
  verifyManualDownload,
} from '../public/desktop-manual-download.mjs';
import {
  MANUAL_CATALOG_LIMIT,
  MANUAL_CATALOG_URL,
  verifyManualCatalog,
} from '../public/desktop-manual-catalog.mjs';
import {
  UPDATE_NOTES_LIMIT,
  updateNotesUrl,
  verifyUpdateNotes,
} from '../public/desktop-update-notes.mjs';
import { launchPublicDeliveryBrowser } from './public-delivery-browser.mjs';

// Cloudflare redirects /download.html to this canonical path.
const WEBSITE_URL = 'https://kerfdesk.com/download';
const JSON_TIMEOUT_MS = 30_000;
const INSTALLER_TIMEOUT_MS = 180_000;
const requireValue = (condition, message) => {
  if (!condition) throw new Error(`Public desktop delivery: ${message}`);
};

/** Hash incrementally; only small metadata responses are collected in memory. */
export async function readPublicObject(
  url,
  { limit, collect = false, timeoutMs = JSON_TIMEOUT_MS },
  fetchRequest = fetch,
) {
  requireValue(Number.isSafeInteger(limit) && limit > 0 && limit <= 300_000_000, 'invalid bound');
  requireValue(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= INSTALLER_TIMEOUT_MS,
    'invalid timeout',
  );
  const controller = new AbortController();
  let reader;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Public desktop delivery: request timed out'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        const response = await fetchRequest(url, {
          method: 'GET',
          redirect: 'error',
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          headers: { 'Accept-Encoding': 'identity' },
          signal: controller.signal,
        });
        requireValue(
          response.status === 200 && !response.redirected && response.body,
          'request failed or redirected',
        );
        const declared = response.headers.get('content-length');
        // fetch exposes decoded bytes, while Content-Length describes the encoded wire body.
        // A CDN may ignore Accept-Encoding: identity; keep the decoded size/hash authoritative.
        const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
        const identityEncoding = encoding === undefined || encoding === 'identity';
        requireValue(
          declared === null ||
            (/^\d+$/u.test(declared) &&
              Number.isSafeInteger(Number(declared)) &&
              Number(declared) > 0 &&
              (!identityEncoding || Number(declared) <= limit)),
          'invalid or oversized content length',
        );
        reader = response.body.getReader();
        const chunks = [];
        const hash = createHash('sha256');
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          requireValue(bytes <= limit, 'response exceeds its bound');
          hash.update(value);
          if (collect) chunks.push(value);
        }
        requireValue(
          bytes > 0 && (!identityEncoding || declared === null || Number(declared) === bytes),
          'response is empty or truncated',
        );
        return {
          url,
          bytes,
          sha256: hash.digest('hex'),
          cacheControl: response.headers.get('cache-control'),
          ...(collect ? { body: Buffer.concat(chunks) } : {}),
        };
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    // Do not let a misbehaving response extend the hard request deadline.
    void reader?.cancel().catch(() => {
      // The response may already have been cancelled by fetch's abort signal.
    });
  }
}

function expectedIdentity(version, sourceSha, versionValidator = commercialArtifactNames) {
  versionValidator(version);
  requireValue(
    typeof sourceSha === 'string' && /^[a-f0-9]{40}$/u.test(sourceSha),
    'invalid source',
  );
}

const objectReceipt = ({ url, bytes, sha256, cacheControl }) => ({
  url,
  bytes,
  sha256,
  cacheControl,
});

export async function verifyPublicDesktopRelease({
  expectedVersion,
  expectedSourceSha,
  keySet,
  fetchRequest = fetch,
}) {
  expectedIdentity(expectedVersion, expectedSourceSha);
  const metadata = (url, limit) => readPublicObject(url, { limit, collect: true }, fetchRequest);
  const latest = await metadata(MANUAL_DOWNLOAD_LATEST_URL, MANUAL_DOWNLOAD_LIMIT);
  const manifest = await verifyManualDownload(latest.body.toString('utf8'), keySet);
  requireValue(
    manifest.version === expectedVersion && manifest.sourceSha === expectedSourceSha,
    'latest differs from the expected version or source',
  );
  requireValue(manifest.codeSigning === 'unsigned', 'expected the unsigned manual release lane');
  const [immutable, catalogue, releaseNotes] = await Promise.all([
    metadata(manualDownloadUrl(manifest.version, 'download-manifest.json'), MANUAL_DOWNLOAD_LIMIT),
    metadata(MANUAL_CATALOG_URL, MANUAL_CATALOG_LIMIT),
    metadata(updateNotesUrl(manifest.version), UPDATE_NOTES_LIMIT),
  ]);
  // Equal bytes inherit the pinned signature verification, not just the same version string.
  requireValue(latest.body.equals(immutable.body), 'latest and immutable manifest differ');
  const entries = await verifyManualCatalog(catalogue.body.toString('utf8'), keySet);
  requireValue(
    entries.some(
      ({ envelope, release }) =>
        release.version === manifest.version &&
        isDeepStrictEqual(envelope, JSON.parse(latest.body.toString('utf8'))),
    ),
    'catalogue omits or conflicts with the latest signed manifest',
  );
  await verifyUpdateNotes(releaseNotes.body.toString('utf8'), keySet, manifest);
  const artifact = manifest.artifacts[0];
  const installer = await readPublicObject(
    manualDownloadUrl(manifest.version, artifact.name),
    { limit: artifact.bytes, timeoutMs: INSTALLER_TIMEOUT_MS },
    fetchRequest,
  );
  requireValue(
    installer.bytes === artifact.bytes && installer.sha256 === artifact.sha256,
    'installer differs from its signed size or SHA-256',
  );
  const finalLatest = await metadata(MANUAL_DOWNLOAD_LATEST_URL, MANUAL_DOWNLOAD_LIMIT);
  requireValue(latest.body.equals(finalLatest.body), 'latest changed during verification');
  return {
    schemaVersion: 1,
    kind: 'desktop-public-delivery-verification',
    verifiedAt: new Date().toISOString(),
    status: 'verified',
    version: manifest.version,
    sourceSha: manifest.sourceSha,
    codeSigning: manifest.codeSigning,
    updates: manifest.updates,
    manifestSha256: immutable.sha256,
    artifact: {
      name: artifact.name,
      bytes: installer.bytes,
      sha256: installer.sha256,
      url: installer.url,
    },
    checks: {
      latestSignature: true,
      immutableManifest: true,
      catalogue: true,
      releaseNotes: true,
      installerBytes: true,
      latestUnchanged: true,
    },
    objects: {
      latest: objectReceipt(latest),
      immutable: objectReceipt(immutable),
      catalogue: objectReceipt(catalogue),
      releaseNotes: objectReceipt(releaseNotes),
    },
    website: null,
    installerExecuted: false,
  };
}

/** Shared read-only browser boundary for the stable and Preview publication checks. */
export async function inspectPublicDownloadPage(outputDirectory, screenshot, inspect) {
  const { expect } = await import('@playwright/test');
  const browser = await launchPublicDeliveryBrowser();
  try {
    const context = await browser.newContext({
      acceptDownloads: false,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    // This audit never needs cookies, analytics writes, form submissions or installer execution.
    await context.route('**/*', (route) => {
      const request = route.request();
      const origin = new URL(request.url()).origin;
      return ['GET', 'HEAD'].includes(request.method()) &&
        ['https://kerfdesk.com', 'https://dl.kerfdesk.com'].includes(origin)
        ? route.continue()
        : route.abort();
    });
    const response = await page.goto(WEBSITE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    requireValue(
      response?.status() === 200 &&
        !response.request().redirectedFrom() &&
        page.url() === WEBSITE_URL,
      'website navigation failed or redirected',
    );
    await inspect(page, expect);
    await page.screenshot({
      path: join(outputDirectory, screenshot),
      fullPage: true,
      timeout: 30_000,
    });
    return { url: WEBSITE_URL, status: 'verified', screenshot };
  } finally {
    await browser.close();
  }
}

/** Exercise the live page with its deployed code and keys, without clicking the installer. */
export async function verifyPublicDownloadPage(receipt, outputDirectory) {
  const website = await inspectPublicDownloadPage(
    outputDirectory,
    'download-page.png',
    async (page, expect) => {
      const download = page.locator('#commercial-download');
      await expect(download).toBeVisible();
      await expect(download).toHaveAttribute('href', receipt.artifact.url);
      await expect(page.locator('#commercial-status')).toContainText(
        `KerfDesk ${receipt.version} ·`,
      );
      await expect(page.locator('#commercial-asset')).toHaveText(receipt.artifact.name);
      await page.getByText('Updates and download verification', { exact: true }).click();
      await expect(page.locator('#commercial-manifest')).toBeVisible();
      await expect(page.locator('#commercial-manifest')).toHaveAttribute(
        'href',
        receipt.objects.immutable.url,
      );
      await expect(page.locator('#commercial-hash')).toHaveText(
        `SHA-256: ${receipt.artifact.sha256}`,
      );
      await expect(page.locator('#commercial-verification')).toContainText(
        'Unsigned installer · Manual updates',
      );
    },
  );
  return {
    ...website,
    installerUrl: receipt.artifact.url,
    manifestUrl: receipt.objects.immutable.url,
    version: receipt.version,
    sha256: receipt.artifact.sha256,
  };
}

export function publicDeliveryArguments(args, versionValidator = commercialArtifactNames) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    requireValue(
      ['--expected-version', '--expected-source-sha', '--output-dir', '--website'].includes(key) &&
        values[key] === undefined,
      'unknown or duplicate argument',
    );
    if (key === '--website') values[key] = true;
    else {
      const value = args[++index];
      requireValue(typeof value === 'string' && !value.startsWith('--'), 'missing argument');
      values[key] = value;
    }
  }
  expectedIdentity(values['--expected-version'], values['--expected-source-sha'], versionValidator);
  requireValue(
    typeof values['--output-dir'] === 'string' && isAbsolute(values['--output-dir']),
    'output must be absolute',
  );
  return {
    expectedVersion: values['--expected-version'],
    expectedSourceSha: values['--expected-source-sha'],
    outputDirectory: resolve(values['--output-dir']),
    website: values['--website'] === true,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = publicDeliveryArguments(process.argv.slice(2));
  await mkdir(options.outputDirectory); // Fresh evidence only; never replace a previous receipt.
  try {
    const keySet = JSON.parse(
      await readFile(new URL('../public/desktop-release-keys.json', import.meta.url), 'utf8'),
    );
    const receipt = await verifyPublicDesktopRelease({ ...options, keySet });
    await writeFile(
      join(options.outputDirectory, 'public-cdn.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { flag: 'wx' },
    );
    if (options.website)
      receipt.website = await verifyPublicDownloadPage(receipt, options.outputDirectory);
    await writeFile(
      join(options.outputDirectory, 'public-delivery.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { flag: 'wx' },
    );
    console.log(
      `Public unsigned Windows delivery verified: ${receipt.version} (${receipt.sourceSha}).`,
    );
  } catch (error) {
    await writeFile(
      join(options.outputDirectory, 'public-delivery-failure.json'),
      `${JSON.stringify({ schemaVersion: 1, status: 'failed', checkedAt: new Date().toISOString(), expectedVersion: options.expectedVersion, expectedSourceSha: options.expectedSourceSha, reason: error.message }, null, 2)}\n`,
      { flag: 'wx' },
    );
    throw error;
  }
}
