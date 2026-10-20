import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { manualDownloadKey } from '../public/desktop-manual-download.mjs';
import { digest, verifyCommercialEnvelope } from './commercial-release-manifest.mjs';
import { retainReleaseReceipt } from './desktop-release-receipt.mjs';
import { createStableReleaseStore } from './stable-release-store.mjs';
import { readRecoveryArchive } from './desktop-receipt-recovery-archive.mjs';
import {
  REPOSITORY,
  recoveryRequest,
  validateRecoveryMain,
  requireRecovery,
  validateOriginalAttempt,
  selectRecoveryArtifacts,
  verifyArtifactBytes,
  originalReceiptContext,
} from './desktop-receipt-recovery.mjs';

const json = (bytes) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
async function boundedResponse(response, limit) {
  requireRecovery(response.status === 200 && response.body, 'evidence request failed');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    requireRecovery(size <= limit, 'evidence response exceeds bound');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function recoveryGithubReader(token, fetchRequest = fetch) {
  requireRecovery(typeof token === 'string' && token.trim(), 'Actions read token is required');
  const api = async (path, redirect = 'error') => {
    const response = await fetchRequest('https://api.github.com/repos/' + REPOSITORY + path, {
      method: 'GET',
      redirect,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
      },
    });
    return response;
  };
  return {
    json: async (path) => json(await boundedResponse(await api(path), 4 * 1024 * 1024)),
    archive: async (artifact) => {
      const response = await api('/actions/artifacts/' + artifact.id + '/zip', 'manual');
      requireRecovery(response.status === 302, 'artifact redirect was not authenticated');
      const url = new URL(response.headers.get('location'));
      requireRecovery(
        url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          /^productionresultssa[a-z0-9]*\.blob\.core\.windows\.net$/u.test(url.hostname),
        'untrusted artifact download origin',
      );
      await response.body?.cancel();
      const download = await fetchRequest(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(120_000),
      });
      return verifyArtifactBytes(artifact, await boundedResponse(download, artifact.size_in_bytes));
    },
  };
}

export function requireOriginalSigningIdentity(env, identity) {
  requireRecovery(
    typeof env.DESKTOP_STABLE_MANIFEST_PRIVATE_KEY === 'string' &&
      env.DESKTOP_STABLE_MANIFEST_PRIVATE_KEY.trim() &&
      env.DESKTOP_STABLE_MANIFEST_KEY_ID === identity.keyId,
    'protected original receipt signing identity is required',
  );
}

export function readOriginalReceiptEvidence({ request, original, archives, keySet }) {
  const identity = json(
    archives.delivery('commercial-preparation/commercial-release-identity.json', 65_536),
  );
  const release = verifyCommercialEnvelope(identity, keySet, 'release-identity');
  requireRecovery(
    release.sourceSha === request.sourceSha &&
      release.version === request.version &&
      release.sourceRef === 'refs/heads/main',
    'signed original identity differs from reviewed input',
  );
  const installerName = 'KerfDesk-' + request.version + '-windows-x64-setup.exe';
  const installerBytes = archives.installer(
    'release/commercial-unsigned/' + request.version + '/' + installerName,
    300_000_000,
  );
  const installer = {
    name: installerName,
    bytes: installerBytes.length,
    sha256: digest(installerBytes),
  };
  const qualification = archives.qualification;
  const launch = json(qualification('installer-qualification/qualification.json'));
  const restoration = json(qualification('installer-qualification/asar-restoration.json'));
  const upgrade = original.firstRelease
    ? undefined
    : json(qualification('installed-qualification/historical-upgrade/qualification.json'));
  const previousManifest = upgrade
    ? qualification(
        'historical-installers/' + upgrade.versions[0] + '/download-manifest.json',
        65_536,
      )
    : undefined;
  const dependencyAudit = json(archives.delivery('unsigned-dependency-audit/report.json'));
  const delivery = json(archives.delivery('public-desktop-delivery/public-delivery.json'));
  return {
    identity,
    installer,
    launch,
    restoration,
    upgrade,
    previousManifest,
    dependencyAudit,
    delivery,
    firstRelease: original.firstRelease,
  };
}

export async function recoverReceipt(args, env = process.env) {
  const request = recoveryRequest(env, args);
  const git = (...params) =>
    execFileSync('git', params, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
  requireRecovery(
    git('rev-parse', 'HEAD') === env.GITHUB_SHA &&
      !git('status', '--porcelain', '--untracked-files=normal'),
    'clean current trusted main checkout is required',
  );
  const reader = recoveryGithubReader(env.GITHUB_TOKEN);
  validateRecoveryMain(env.GITHUB_SHA, await reader.json('/git/ref/heads/main'));
  const runPath = '/actions/runs/' + request.runId + '/attempts/' + request.runAttempt;
  const original = validateOriginalAttempt(
    request,
    await reader.json(runPath),
    await reader.json(runPath + '/jobs?per_page=100'),
  );
  // Control SHA and candidate SHA can differ on workflow_run. Both must be
  // authenticated ancestors of current main; original executable code is never run.
  git('merge-base', '--is-ancestor', original.run.head_sha, env.GITHUB_SHA);
  git('merge-base', '--is-ancestor', request.sourceSha, env.GITHUB_SHA);
  const artifacts = selectRecoveryArtifacts(
    request,
    original,
    await reader.json('/actions/runs/' + request.runId + '/artifacts?per_page=100'),
  );
  const archives = {};
  for (const [kind, artifact] of Object.entries(artifacts))
    archives[kind] = readRecoveryArchive(await reader.archive(artifact));
  const keySet = json(await readFile('public/desktop-release-keys.json'));
  const evidence = readOriginalReceiptEvidence({ request, original, archives, keySet });
  const lockfile = execFileSync('git', ['show', request.sourceSha + ':pnpm-lock.yaml'], {
    maxBuffer: 4 * 1024 * 1024,
  });
  requireOriginalSigningIdentity(env, evidence.identity);
  // Large artifact reads can take minutes; recheck main before any storage write.
  validateRecoveryMain(env.GITHUB_SHA, await reader.json('/git/ref/heads/main'));
  const store = await createStableReleaseStore({
    accountId: env.COMMERCIAL_CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.COMMERCIAL_R2_API_TOKEN,
  });
  const manifest = await store.get(manualDownloadKey(request.version, 'download-manifest.json'));
  const result = await retainReleaseReceipt({
    ...evidence,
    keySet,
    context: originalReceiptContext(request),
    lockfileSha256: digest(lockfile),
    manifest,
    store,
    keyId: env.DESKTOP_STABLE_MANIFEST_KEY_ID,
    privateKeyPem: env.DESKTOP_STABLE_MANIFEST_PRIVATE_KEY,
  });
  // Distinct recovery audit, never added to the immutable original receipt payload.
  const directory = resolve(env.RUNNER_TEMP, 'desktop-receipt-recovery');
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, 'recovery.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: 'desktop-receipt-recovery',
        status: result.status,
        historicalDeliveryOnly: true,
        recovery: {
          runId: env.GITHUB_RUN_ID,
          runAttempt: env.GITHUB_RUN_ATTEMPT,
          controlSha: env.GITHUB_SHA,
        },
        original: { ...request, controlSha: original.run.head_sha },
        artifacts: Object.fromEntries(
          Object.entries(artifacts).map(([kind, artifact]) => [
            kind,
            {
              id: artifact.id,
              name: artifact.name,
              digest: artifact.digest,
              bytes: artifact.size_in_bytes,
            },
          ]),
        ),
        receipt: result,
      },
      null,
      2,
    ) + '\n',
  );
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  recoverReceipt(process.argv.slice(2))
    .then((result) => console.log('Original release receipt ' + result.status + '.'))
    .catch(() => {
      console.error('Receipt recovery failed; inspect original evidence without republishing.');
      process.exitCode = 1;
    });
