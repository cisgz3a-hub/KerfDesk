import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireStablePublishContext } from './publish-stable-release.mjs';

const UPLOAD_STEP = 'Upload installer + update feed as workflow artifact';
const PUBLISH_STEP = 'Publish installer + update feed to Cloudflare R2';

// Same-run artifacts survive a job rerun. An absent artifact is safe to rebuild
// only when EVERY previous attempt proves it never reached successful upload.
// https://docs.github.com/en/rest/actions/artifacts#list-workflow-run-artifacts
// https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt
export async function planStableReleaseRetry({ env, version, fetchRequest = fetch }) {
  requireStablePublishContext(env, version);
  const runId = Number(env.GITHUB_RUN_ID);
  const attempt = Number(env.GITHUB_RUN_ATTEMPT);
  if (
    !Number.isSafeInteger(runId) ||
    runId <= 0 ||
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt > 20
  )
    throw new Error('Invalid or unsupported stable workflow retry identity.');
  if (attempt === 1) return { reuseArtifact: false };
  if (typeof env.GITHUB_TOKEN !== 'string' || env.GITHUB_TOKEN.trim() === '')
    throw new Error('Stable retry requires the workflow Actions read token.');
  const request = githubReader(env.GITHUB_TOKEN, fetchRequest);
  const runPath = `/repos/cisgz3a-hub/KerfDesk/actions/runs/${runId}`;
  const listing = await request(`${runPath}/artifacts?per_page=100`);
  const artifacts = completeList(listing, 'artifacts');
  const matches = artifacts.filter((artifact) => artifact.name === `kerfdesk-windows-${version}`);
  if (matches.length > 1) throw new Error('Stable retry artifact identity is ambiguous.');
  if (matches.length === 1) {
    const artifact = matches[0];
    if (
      artifact.expired !== false ||
      !Number.isSafeInteger(artifact.id) ||
      artifact.id <= 0 ||
      artifact.workflow_run?.id !== runId ||
      artifact.workflow_run?.head_sha !== env.GITHUB_SHA
    )
      throw new Error('Original stable artifact is expired or belongs to another source/run.');
    return { reuseArtifact: true, artifactId: artifact.id };
  }
  for (let previous = 1; previous < attempt; previous += 1) {
    const listing = await request(`${runPath}/attempts/${previous}/jobs?per_page=100`);
    requireNeverUploaded(completeList(listing, 'jobs'), runId, env.GITHUB_SHA);
  }
  return { reuseArtifact: false };
}

function completeList(response, key) {
  const entries = response[key];
  if (
    !Array.isArray(entries) ||
    !Number.isSafeInteger(response.total_count) ||
    response.total_count !== entries.length ||
    entries.length > 100
  )
    throw new Error(`Stable retry ${key} lookup is incomplete or invalid.`);
  return entries;
}

function requireNeverUploaded(jobs, runId, sourceSha) {
  if (
    jobs.length === 0 ||
    jobs.some(
      (job) => job.run_id !== runId || job.head_sha !== sourceSha || job.status !== 'completed',
    )
  )
    throw new Error('Prior stable attempt identity or completion is unconfirmed.');
  const builds = jobs.filter((job) => job.name === 'Build Windows installer');
  if (
    builds.length === 0 &&
    jobs.every(
      (job) =>
        job.name === 'Validate stable release tag' &&
        ['failure', 'cancelled', 'skipped'].includes(job.conclusion),
    )
  )
    return;
  if (builds.length !== 1 || !Array.isArray(builds[0].steps))
    throw new Error('Prior stable build steps are unavailable.');
  const upload = builds[0].steps.find((step) => step.name === UPLOAD_STEP);
  const publish = builds[0].steps.find((step) => step.name === PUBLISH_STEP);
  if (
    upload?.conclusion === 'success' ||
    (publish !== undefined && publish.conclusion !== 'skipped')
  )
    throw new Error(
      'Original stable artifact is missing after upload/publication. Restore the original artifact or use reviewed new-version recovery.',
    );
  if (
    !['failure', 'cancelled', 'skipped'].includes(upload?.conclusion) ||
    publish?.conclusion !== 'skipped'
  )
    throw new Error('Cannot prove the original stable artifact was never uploaded.');
}

function githubReader(token, fetchRequest) {
  return async (path) => {
    const response = await fetchRequest(`https://api.github.com${path}`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
      },
    });
    if (response.status !== 200)
      throw new Error(`Stable retry lookup failed: HTTP ${response.status}.`);
    return response.json();
  };
}

async function main() {
  const [version, ...extra] = process.argv.slice(2);
  if (extra.length > 0 || !process.env.GITHUB_OUTPUT)
    throw new Error('Stable retry requires a version and GitHub step output file.');
  const plan = await planStableReleaseRetry({ env: process.env, version });
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `reuse-artifact=${plan.reuseArtifact}\nartifact-id=${plan.artifactId ?? ''}\n`,
  );
  process.stdout.write(
    plan.reuseArtifact
      ? `Restore original stable artifact ${plan.artifactId}.\n`
      : 'No earlier artifact publication; build a new release instance.\n',
  );
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    process.stderr.write(`Stable retry preparation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
