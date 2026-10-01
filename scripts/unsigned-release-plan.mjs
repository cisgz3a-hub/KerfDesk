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
import { updateNotesUrl } from '../public/desktop-update-notes.mjs';
import { readReviewedDesktopUpdateNotes } from './reviewed-desktop-update-notes.mjs';
import { requireNotesBaseline } from './manual-commercial-notes.mjs';

const REPOSITORY = 'cisgz3a-hub/KerfDesk';
const WORKFLOWS = ['ci.yml', 'e2e.yml', 'desktop-package-check.yml'];
export const RELEASE_PR_THRESHOLD = 20;
const SHA = /^[a-f0-9]{40}$/u;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function output(values) {
  for (const [name, value] of Object.entries(values)) {
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  console.log(JSON.stringify(values));
  if (process.env.GITHUB_STEP_SUMMARY && values.mergedPrCount !== undefined)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `Release batch: ${values.mergedPrCount}/${RELEASE_PR_THRESHOLD} merged PRs. Release now: ${values.releaseNow}. ${values.reason}\n`,
    );
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
  const { decision } = await inspectReleaseBatch(sourceSha);
  return output({ eligible: decision.publish, sourceSha, ...batchEvidence(decision) });
}

/** A dispatch alone is not an instruction to bypass the release batch. */
export function releaseNowRequested(env) {
  const value = env.KERFDESK_RELEASE_NOW ?? 'false';
  if (!['true', 'false'].includes(value)) throw new Error('Invalid release-now selection.');
  if (
    value === 'true' &&
    (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main')
  )
    throw new Error('Release now requires an explicit manual dispatch on main.');
  return value === 'true';
}

/** Reachability, not commit dates or publication time, defines the unreleased work. */
export function commitsSinceRelease(previous, candidate, execute = git) {
  if (!SHA.test(previous) || !SHA.test(candidate)) throw new Error('Invalid release source.');
  execute('merge-base', '--is-ancestor', previous, candidate);
  const text = execute('rev-list', `${previous}..${candidate}`).trim();
  const commits = text ? text.split(/\r?\n/u) : [];
  if (commits.some((sha) => !SHA.test(sha))) throw new Error('Invalid source history.');
  return new Set(commits);
}

function mergedIntoRange(pull, commits) {
  if (
    !Number.isSafeInteger(pull?.number) ||
    pull.number < 1 ||
    !['open', 'closed'].includes(pull.state) ||
    typeof pull.base?.ref !== 'string' ||
    pull.base.repo?.full_name !== REPOSITORY
  )
    throw new Error('Cannot verify a pull request from GitHub.');
  if (pull.merged_at === null) return false;
  if (
    pull.state !== 'closed' ||
    typeof pull.merged_at !== 'string' ||
    !Number.isFinite(Date.parse(pull.merged_at)) ||
    !SHA.test(pull.merge_commit_sha ?? '')
  )
    throw new Error('Cannot verify a pull request merge from GitHub.');
  // GitHub records the merge commit, squash commit, or last rebased commit here.
  return pull.base.ref === 'main' && commits.has(pull.merge_commit_sha);
}

async function boundedGitHubJson(response) {
  const chunks = [];
  let size = 0;
  if (!response.body) throw new Error('GitHub returned no pull request evidence.');
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 16_777_216) throw new Error('GitHub pull request page exceeds its limit.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Complete, bounded pagination. An error is never a partial or guessed PR count. */
export async function mergedPullRequestsSince(commits, token, fetchPage = fetch) {
  if (!token) throw new Error('Pull request evidence requires a GitHub token.');
  const seen = new Set();
  const merged = [];
  const deadline = AbortSignal.timeout(120_000);
  for (let page = 1; page <= 100; page += 1) {
    // Enumerate all PRs by creation, so new merges, closes and edits cannot move
    // earlier records between pages. Filter main/merged status only afterwards.
    const url = new URL(`https://api.github.com/repos/${REPOSITORY}/pulls`);
    url.search = new URLSearchParams({
      state: 'all',
      sort: 'created',
      direction: 'asc',
      per_page: '100',
      page: String(page),
    });
    const response = await fetchPage(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.any([deadline, AbortSignal.timeout(30_000)]),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`Cannot verify release PRs: HTTP ${response.status}.`);
    }
    const pulls = await boundedGitHubJson(response);
    if (!Array.isArray(pulls) || pulls.length > 100)
      throw new Error('Invalid GitHub pull request page.');
    for (const pull of pulls) {
      const included = mergedIntoRange(pull, commits);
      if (seen.has(pull.number)) throw new Error('GitHub pull request pagination changed.');
      seen.add(pull.number);
      if (included) merged.push(pull.number);
    }
    if (pulls.length < 100) {
      if (/rel="next"/u.test(response.headers.get('link') ?? ''))
        throw new Error('GitHub pull request pagination is incomplete.');
      return merged.sort((a, b) => a - b);
    }
  }
  throw new Error('Pull request pagination exceeds 100 pages; review the release evidence.');
}

export function releaseBatchDecision(hasBaseline, mergedPullRequests, releaseNow) {
  const publish =
    releaseNow === true || (hasBaseline && mergedPullRequests.length >= RELEASE_PR_THRESHOLD);
  const reason = !hasBaseline
    ? releaseNow
      ? 'Initial release explicitly requested.'
      : 'No authenticated release baseline; an explicit release-now dispatch is required.'
    : `${mergedPullRequests.length}/${RELEASE_PR_THRESHOLD} merged PRs since the published source.`;
  return { publish, mergedPullRequests, releaseNow, reason };
}

function batchEvidence(decision) {
  return {
    mergedPrCount: decision.mergedPullRequests.length,
    mergedPullRequests: decision.mergedPullRequests.join(','),
    releaseNow: decision.releaseNow,
    reason: decision.reason,
  };
}

async function inspectReleaseBatch(sourceSha) {
  const releaseNow = releaseNowRequested(process.env);
  const bytes = await latestBytes();
  const keys = JSON.parse(await readFile('public/desktop-release-keys.json', 'utf8'));
  const latest = bytes === null ? null : await verifyManualDownload(bytes.toString('utf8'), keys);
  const commits = latest ? commitsSinceRelease(latest.sourceSha, sourceSha) : null;
  const pulls = commits?.size
    ? await mergedPullRequestsSince(commits, process.env.GITHUB_TOKEN)
    : [];
  const decision = releaseBatchDecision(latest !== null, pulls, releaseNow);
  if (latest?.sourceSha === sourceSha) {
    decision.publish = false;
    decision.reason = 'This source is already published.';
  }
  if (decision.publish)
    requireNotesBaseline(await readReviewedDesktopUpdateNotes(sourceSha, process.cwd()), latest);
  return { bytes, latest, decision };
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
  const urls = [
    ...[commercialArtifactNames(version)[0], 'download-manifest.json'].map((name) =>
      manualDownloadUrl(version, name),
    ),
    updateNotesUrl(version),
  ];
  for (const url of urls) {
    const response = await request(url, 'HEAD');
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
  // Recheck the authenticated pointer and the same batch policy after qualification.
  const { bytes, latest, decision } = await inspectReleaseBatch(sourceSha);
  if (!decision.publish) return output({ publish: false, ...batchEvidence(decision) });
  let version = latest ? nextPatch(latest.version) : '1.0.0';
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (!(await occupied(version)))
      return output({
        publish: true,
        ...batchEvidence(decision),
        version,
        sourceSha,
        sourceRef: 'refs/heads/main',
        publishedAt: new Date().toISOString(),
        expectedLatestSha256: bytes === null ? 'none' : digest(bytes),
        previousVersion: latest?.version ?? '',
        previousSourceSha: latest?.sourceSha ?? '',
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
      'Unsigned release planning failed; verify main, required checks, complete merged-PR evidence and authenticated release metadata.',
    );
    process.exitCode = 1;
  });
}
