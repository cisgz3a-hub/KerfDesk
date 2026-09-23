import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What the deploy lane's candidate phase needs to know when the CI-validated
 * commit is no longer main's tip (ADR-311 Amendment 2). Everything comes from
 * GitHub's own records and git, so a candidate that does not build stays
 * provider-free:
 *
 * - `newerValidatedSha`: a commit on main, newer than the candidate, that has
 *   already passed CI. Its own deploy run is queued behind this one (or has
 *   run), so building the candidate would only waste the serialized lane.
 * - `productionSha`: the commit this lane last published, read from the newest
 *   deploy run whose publish step succeeded and the readiness artifact that
 *   run names after its commit.
 *
 * A lookup that fails is recorded as `unavailable`. The resolver then keeps
 * the old rule, so a failure can only narrow what builds, never widen it.
 */

export const CI_WORKFLOW_FILE = 'ci.yml';
export const DEPLOY_WORKFLOW_FILE = 'deploy.yml';
export const PUBLISH_STEP_NAME = 'Publish to Cloudflare Pages';
export const READINESS_ARTIFACT_PREFIX = 'release-readiness-deploy-';
export const RUN_WINDOW = 30;

const FULL_SHA = /^[0-9a-f]{40}$/u;

export async function gatherLaneEvidence({
  candidateSha,
  currentMainSha,
  currentRunId,
  fetchJson,
  isAncestor,
}) {
  try {
    const onMain = isAncestor(candidateSha, currentMainSha);
    if (onMain === null) throw new Error(`git cannot place ${candidateSha} against main`);
    const newerValidatedSha = await newerValidatedCommit({
      candidateSha,
      currentMainSha,
      fetchJson,
      isAncestor,
    });
    const production = await lastPublication({ currentRunId, fetchJson });
    return {
      unavailable: null,
      candidateOnMain: onMain,
      newerValidatedSha,
      productionSha: production.sha,
      productionRelation:
        production.sha === null ? null : relationTo(production.sha, candidateSha, isAncestor),
      productionEvidence: production.evidence,
    };
  } catch (error) {
    return { unavailable: singleLine(error instanceof Error ? error.message : String(error)) };
  }
}

async function newerValidatedCommit({ candidateSha, currentMainSha, fetchJson, isAncestor }) {
  const page = await fetchJson(
    `actions/workflows/${CI_WORKFLOW_FILE}/runs?branch=main&status=success&per_page=${RUN_WINDOW}`,
  );
  for (const sha of uniqueShas(listOf(page, 'workflow_runs').map((run) => run.head_sha))) {
    if (sha === candidateSha) continue;
    // Only a definite `true` counts. A commit git cannot place (never fetched,
    // or a fork's branch that happens to be called main) never supersedes.
    if (isAncestor(candidateSha, sha) === true && isAncestor(sha, currentMainSha) === true) {
      return sha;
    }
  }
  return null;
}

async function lastPublication({ currentRunId, fetchJson }) {
  const page = await fetchJson(
    `actions/workflows/${DEPLOY_WORKFLOW_FILE}/runs?status=completed&per_page=${RUN_WINDOW}`,
  );
  for (const run of listOf(page, 'workflow_runs')) {
    // A skipped run never started its job, so it cannot have published.
    if (String(run.id) === String(currentRunId) || run.conclusion === 'skipped') continue;
    const jobs = await fetchJson(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
    if (!publishStepSucceeded(listOf(jobs, 'jobs'))) continue;
    const artifacts = await fetchJson(`actions/runs/${run.id}/artifacts?per_page=100`);
    const shas = uniqueShas(
      listOf(artifacts, 'artifacts')
        .map((artifact) => String(artifact.name ?? ''))
        .filter((name) => name.startsWith(READINESS_ARTIFACT_PREFIX))
        .map((name) => name.slice(READINESS_ARTIFACT_PREFIX.length)),
    );
    // The newest publication decides. If it cannot be tied to exactly one
    // commit, production is unknown: an older run must not stand in for it.
    return shas.length === 1
      ? { sha: shas[0], evidence: `deploy run ${run.id} published it` }
      : {
          sha: null,
          evidence: `deploy run ${run.id} published, but its readiness artifact names ${shas.length} commits`,
        };
  }
  return {
    sha: null,
    evidence: `none of the last ${RUN_WINDOW} completed deploy runs published`,
  };
}

function publishStepSucceeded(jobs) {
  return jobs.some((job) =>
    (Array.isArray(job.steps) ? job.steps : []).some(
      (step) => step.name === PUBLISH_STEP_NAME && step.conclusion === 'success',
    ),
  );
}

function relationTo(productionSha, candidateSha, isAncestor) {
  if (productionSha === candidateSha) return 'same';
  return isAncestor(productionSha, candidateSha) === true ? 'older' : 'other';
}

function listOf(response, key) {
  const list = response?.[key];
  if (!Array.isArray(list)) throw new Error(`GitHub API response has no ${key} list`);
  return list;
}

function uniqueShas(values) {
  const shas = values.map((value) =>
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
  return [...new Set(shas.filter((sha) => FULL_SHA.test(sha)))];
}

function singleLine(text) {
  return text.replace(/\s+/gu, ' ').trim() || 'unknown error';
}

export function gitIsAncestor(ancestor, descendant, { cwd } = {}) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd,
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    // Exit 1 is git's "no"; anything else (an unknown commit) is "cannot say".
    return error?.status === 1 ? false : null;
  }
}

export function githubFetchJson({ apiUrl, repository, token, fetchImpl = fetch }) {
  return async (path) => {
    const response = await fetchImpl(`${apiUrl}/repos/${repository}/${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'kerfdesk-deploy-lane',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`GitHub API answered ${response.status} for ${path}`);
    return response.json();
  };
}

function requiredSha(value, label) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!FULL_SHA.test(normalized)) throw new Error(`${label} is not a full git SHA: ${value}`);
  return normalized;
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function runCli() {
  const candidateSha = requiredSha(argument('candidate-sha'), 'candidate SHA');
  const currentMainSha = requiredSha(argument('current-main-sha'), 'current main SHA');
  const output = argument('output');
  const repository = process.env.GITHUB_REPOSITORY;
  if (!output) throw new Error('--output is required');
  if (!repository) throw new Error('GITHUB_REPOSITORY is required');
  const evidence = await gatherLaneEvidence({
    candidateSha,
    currentMainSha,
    currentRunId: process.env.GITHUB_RUN_ID,
    fetchJson: githubFetchJson({
      apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
      repository,
      token: process.env.GITHUB_TOKEN,
    }),
    isAncestor: gitIsAncestor,
  });
  const serialized = JSON.stringify(evidence);
  writeFileSync(resolve(output), `${serialized}\n`);
  process.stdout.write(`${serialized}\n`);
  if (evidence.unavailable !== null) {
    process.stdout.write(
      `::warning title=Deploy lane evidence unavailable::${evidence.unavailable}\n`,
    );
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`web deploy lane evidence failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
