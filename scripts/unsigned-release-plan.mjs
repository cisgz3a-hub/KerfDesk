// Main-only release automation for the authenticated, unsigned Windows lane.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MANUAL_DOWNLOAD_LATEST_KEY,
  manualDownloadUrl,
  verifyManualDownload,
} from '../public/desktop-manual-download.mjs';
import { commercialArtifactNames } from '../public/desktop-commercial-catalog.mjs';

const REPOSITORY = 'cisgz3a-hub/KerfDesk';
const WORKFLOWS = ['ci.yml', 'e2e.yml', 'desktop-package-check.yml'];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function output(values) {
  for (const [name, value] of Object.entries(values)) {
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  console.log(JSON.stringify(values));
}

/** Only the latest run of each required workflow on this exact push may qualify it. */
export function successfulPush(runs, sourceSha, path) {
  const latest = runs
    .filter(
      (run) =>
        run.head_sha === sourceSha &&
        run.head_branch === 'main' &&
        run.event === 'push' &&
        run.path === `.github/workflows/${path}` &&
        run.repository?.full_name === REPOSITORY &&
        run.head_repository?.full_name === REPOSITORY,
    )
    .sort((a, b) => b.id - a.id)[0];
  return latest?.status === 'completed' && latest.conclusion === 'success';
}

async function gate() {
  const sourceSha = git('rev-parse', 'HEAD');
  if (process.env.GITHUB_REPOSITORY !== REPOSITORY || !/^[a-f0-9]{40}$/u.test(sourceSha))
    throw new Error('Unsigned release requires the canonical repository and exact source.');
  if (sourceSha !== git('rev-parse', 'refs/remotes/origin/main'))
    return output({ eligible: false, reason: 'A newer main commit superseded this candidate.' });
  for (const workflow of WORKFLOWS) {
    const url = new URL(
      `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${workflow}/runs`,
    );
    url.search = new URLSearchParams({
      head_sha: sourceSha,
      branch: 'main',
      event: 'push',
      per_page: '100',
    });
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Cannot verify release checks: HTTP ${response.status}.`);
    const body = await response.json();
    if (
      !Array.isArray(body.workflow_runs) ||
      !successfulPush(body.workflow_runs, sourceSha, workflow)
    )
      return output({ eligible: false, reason: `${workflow} has not passed on this main push.` });
  }
  return output({ eligible: true, sourceSha });
}

async function request(url, method = 'GET') {
  const response = await fetch(url, {
    method,
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (![200, 404].includes(response.status)) {
    await response.body?.cancel();
    throw new Error(`Release metadata answered HTTP ${response.status}.`);
  }
  return response;
}

async function latestBytes() {
  const response = await request(`https://dl.kerfdesk.com/${MANUAL_DOWNLOAD_LATEST_KEY}`);
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) throw new Error('Release metadata has no body.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 65_536) throw new Error('Release metadata exceeds its size limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function nextPatch(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version))
    throw new Error('Invalid previous stable version.');
  const [major, minor, patch] = version.split('.').map(Number);
  if ([major, minor, patch].some((n) => !Number.isSafeInteger(n) || n > 65_534))
    throw new Error('Automatic version is outside the Windows version range.');
  return `${major}.${minor}.${patch + 1}`;
}

async function occupied(version) {
  for (const name of [commercialArtifactNames(version)[0], 'download-manifest.json']) {
    const response = await request(manualDownloadUrl(version, name), 'HEAD');
    await response.body?.cancel();
    if (response.status === 200) return true;
  }
  return false;
}

async function plan() {
  const sourceSha = git('rev-parse', 'HEAD');
  if (git('status', '--porcelain', '--untracked-files=normal'))
    throw new Error('Release preparation requires a clean checkout.');
  if (sourceSha !== git('rev-parse', 'refs/remotes/origin/main'))
    return output({ publish: false, reason: 'A newer main commit superseded this candidate.' });
  if (!(await readFile('LICENSE', 'utf8')).includes('All rights reserved'))
    throw new Error('Current proprietary LICENSE is required.');
  const bytes = await latestBytes();
  const keys = JSON.parse(await readFile('public/desktop-release-keys.json', 'utf8'));
  const latest = bytes === null ? null : await verifyManualDownload(bytes.toString('utf8'), keys);
  if (latest?.sourceSha === sourceSha)
    return output({ publish: false, reason: 'This source is already published.' });
  if (latest) git('merge-base', '--is-ancestor', latest.sourceSha, sourceSha);
  let version = latest ? nextPatch(latest.version) : '1.0.0';
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (!(await occupied(version)))
      return output({
        publish: true,
        version,
        sourceSha,
        sourceRef: 'refs/heads/main',
        publishedAt: new Date().toISOString(),
        expectedLatestSha256: bytes === null ? 'none' : digest(bytes),
      });
    version = nextPatch(version);
  }
  throw new Error('Sixteen release versions are occupied; review interrupted publications.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2];
  (command === 'gate'
    ? gate()
    : command === 'plan'
      ? plan()
      : Promise.reject(new Error('Expected gate or plan.'))
  ).catch(() => {
    console.error(
      'Unsigned release planning failed; verify main, required checks and authenticated release metadata.',
    );
    process.exitCode = 1;
  });
}
