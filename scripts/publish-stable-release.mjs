import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadStableRelease, stableVersionParts } from './stable-release-artifacts.mjs';
import { publishStableRelease } from './stable-release-publisher.mjs';
import { createStableReleaseStore } from './stable-release-store.mjs';

const execFileAsync = promisify(execFile);

export function requireStablePublishContext(env, version) {
  stableVersionParts(version);
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_EVENT_NAME !== 'push' ||
    env.GITHUB_REF_TYPE !== 'tag' ||
    env.GITHUB_REF !== `refs/tags/v${version}` ||
    env.GITHUB_REPOSITORY !== 'cisgz3a-hub/KerfDesk' ||
    env.GITHUB_WORKFLOW_REF !==
      `cisgz3a-hub/KerfDesk/.github/workflows/release-desktop-stable.yml@refs/tags/v${version}` ||
    !/^[0-9a-f]{40}$/u.test(env.GITHUB_SHA ?? '') ||
    env.GITHUB_SHA !== env.APPROVED_RELEASE_SHA ||
    env.STABLE_PUBLICATION_GROUP !== 'kerfdesk-stable-publication'
  )
    throw new Error(
      'Stable publication requires the approved tag-push workflow and shared publication owner.',
    );
}

async function verifyInstaller(bytes) {
  const directory = await mkdtemp(join(tmpdir(), 'kerfdesk-stable-signature-'));
  try {
    const executable = join(directory, 'installer.exe');
    await writeFile(executable, bytes);
    await execFileAsync(
      'pwsh',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$signature = Get-AuthenticodeSignature -LiteralPath $env:KERFDESK_RELEASE_VERIFY_PATH; if ($signature.Status -ne "Valid" -or [string]::IsNullOrWhiteSpace($signature.SignerCertificate.Subject)) { throw "Stable installer Authenticode verification failed." }',
      ],
      { env: { ...process.env, KERFDESK_RELEASE_VERIFY_PATH: executable }, windowsHide: true },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const [releaseDir, version, ...extra] = process.argv.slice(2);
  if (releaseDir === undefined || version === undefined || extra.length > 0)
    throw new Error('Usage: publish-stable-release.mjs <release-directory> <version>');
  requireStablePublishContext(process.env, version);
  const release = await loadStableRelease(resolve(releaseDir), version, process.env.GITHUB_SHA);
  const store = await createStableReleaseStore({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
  });
  const result = await publishStableRelease({ release, store, verifyInstaller });
  process.stdout.write(`Stable release ${result.version}: ${result.status}.\n`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    process.stderr.write(`Stable publication failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
