import { digest } from './commercial-release-manifest.mjs';

export const REPOSITORY = 'cisgz3a-hub/KerfDesk';
export const ORIGINAL_WORKFLOW = '.github/workflows/release-desktop-unsigned.yml';
export const RECOVERY_WORKFLOW = '.github/workflows/recover-desktop-release-receipt.yml';
export const RECEIPT_STEP = 'Archive a signed success receipt with the immutable release';
export const UPLOADS = {
  qualification: 'Retain installed Windows qualification evidence',
  delivery: 'Retain dependency and public delivery evidence for every attempted publication',
  installer: 'Preserve a failed release for inspection',
};
const REQUIRED = [
  'Plan a new immutable version from the verified public release',
  'Install the locked dependency graph',
  'Require current packaged-runtime advisory evidence',
  'Build the desktop source that passed the required checks',
  'Prepare the production licence identity and unsigned installer',
  'Package the verified unsigned Windows installer',
  'Install, launch and uninstall the production Windows candidate',
  'Verify packaged security and refuse a modified application archive',
  'Verify delivery browser is available before publication',
  'Publish immutable installer, verified history and notification manifest',
  'Hand the published release identity to the macOS and Linux builds',
  'Verify customer delivery through the public CDN and download page',
];
export const UPGRADE_STEP =
  'Require retained projects and profile when upgrading from the published version';
export function requireRecovery(value, message) {
  if (!value) throw new Error('Receipt recovery refused: ' + message + '.');
}
const id = (value) => /^[1-9]\d{0,19}$/u.test(value ?? '') && Number.isSafeInteger(Number(value));
const sha = (value) => /^[a-f0-9]{40}$/u.test(value ?? '');
const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function recoveryRequest(env, args) {
  requireRecovery(args.length === 4, 'run, attempt, source and version are required');
  const [runId, runAttempt, sourceSha, version] = args;
  requireRecovery(
    id(runId) &&
      /^[1-9]\d{0,5}$/u.test(runAttempt ?? '') &&
      sha(sourceSha) &&
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version ?? ''),
    'invalid original identity',
  );
  requireRecovery(
    env.GITHUB_ACTIONS === 'true' &&
      env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      env.GITHUB_REPOSITORY === REPOSITORY &&
      env.GITHUB_REF === 'refs/heads/main' &&
      env.GITHUB_WORKFLOW_REF === REPOSITORY + '/' + RECOVERY_WORKFLOW + '@refs/heads/main' &&
      env.KERFDESK_UNSIGNED_RELEASES === 'on' &&
      sha(env.GITHUB_SHA) &&
      id(env.GITHUB_RUN_ID) &&
      /^[1-9]\d{0,5}$/u.test(env.GITHUB_RUN_ATTEMPT ?? '') &&
      runId !== env.GITHUB_RUN_ID,
    'protected canonical main manual recovery is required',
  );
  return { runId, runAttempt, sourceSha, version };
}

export function validateRecoveryMain(sourceSha, ref) {
  requireRecovery(
    ref?.ref === 'refs/heads/main' && ref.object?.type === 'commit' && ref.object.sha === sourceSha,
    'authenticated current main differs from the trusted checkout',
  );
}

export function completeList(response, key) {
  requireRecovery(
    Array.isArray(response?.[key]) &&
      response[key].length <= 100 &&
      response.total_count === response[key].length,
    'incomplete ' + key + ' listing',
  );
  return response[key];
}

function successful(step) {
  return (
    step?.status === 'completed' &&
    step.conclusion === 'success' &&
    timestamp(step.started_at) &&
    timestamp(step.completed_at) &&
    Date.parse(step.started_at) <= Date.parse(step.completed_at)
  );
}

export function validateOriginalAttempt(request, run, jobsResponse) {
  requireRecovery(
    run?.id === Number(request.runId) &&
      run.run_attempt === Number(request.runAttempt) &&
      run.repository?.full_name === REPOSITORY &&
      Number.isSafeInteger(run.repository.id) &&
      run.repository.id > 0 &&
      run.head_repository?.full_name === REPOSITORY &&
      run.head_repository.id === run.repository.id &&
      run.path === ORIGINAL_WORKFLOW &&
      run.head_branch === 'main' &&
      sha(run.head_sha) &&
      ['workflow_dispatch', 'workflow_run'].includes(run.event) &&
      run.status === 'completed' &&
      run.conclusion === 'failure',
    'original canonical main attempt was not a completed failure',
  );
  const jobs = completeList(jobsResponse, 'jobs');
  requireRecovery(
    jobs.length > 0 &&
      jobs.every(
        (job) =>
          job.run_id === run.id &&
          job.run_attempt === run.run_attempt &&
          job.head_sha === run.head_sha &&
          job.status === 'completed',
      ),
    'jobs belong to another or unfinished attempt',
  );
  const onlyJob = (name) => {
    const matches = jobs.filter((job) => job.name === name);
    requireRecovery(matches.length === 1, 'ambiguous original ' + name + ' job');
    return matches[0];
  };
  const gate = onlyJob('qualify');
  requireRecovery(gate.conclusion === 'success', 'original source checks did not pass');
  const job = onlyJob('publish');
  requireRecovery(
    job.conclusion === 'failure' && Array.isArray(job.steps),
    'receipt job did not fail',
  );
  const steps = job.steps;
  requireRecovery(
    new Set(steps.map((step) => step.name)).size === steps.length &&
      new Set(steps.map((step) => step.number)).size === steps.length,
    'ambiguous original steps',
  );
  const step = (name) => steps.find((entry) => entry.name === name);
  const receipt = step(RECEIPT_STEP);
  requireRecovery(
    receipt?.status === 'completed' && receipt.conclusion === 'failure',
    'only an originally failed receipt step can be retried',
  );
  requireRecovery(
    REQUIRED.every((name) => successful(step(name)) && step(name).number < receipt.number),
    'original build, qualification, publication or public delivery did not pass',
  );
  const upgrade = step(UPGRADE_STEP);
  requireRecovery(
    successful(upgrade) || (upgrade?.status === 'completed' && upgrade.conclusion === 'skipped'),
    'historical upgrade was neither passed nor explicitly skipped',
  );
  requireRecovery(
    Object.values(UPLOADS).every((name) => successful(step(name))),
    'original retained evidence upload did not pass',
  );
  return { run, job, steps, firstRelease: upgrade.conclusion === 'skipped' };
}

export function selectRecoveryArtifacts(request, original, response, now = Date.now()) {
  const entries = completeList(response, 'artifacts');
  const names = {
    qualification: 'unsigned-installer-qualification-' + request.version + '-' + request.runAttempt,
    delivery: 'unsigned-release-delivery-' + request.version + '-' + request.runAttempt,
    installer: 'unsigned-release-' + request.version + '-' + request.runAttempt,
  };
  return Object.fromEntries(
    Object.entries(names).map(([kind, name]) => {
      const matches = entries.filter((artifact) => artifact.name === name);
      requireRecovery(matches.length === 1, 'missing or ambiguous ' + kind + ' artifact');
      const artifact = matches[0];
      const upload = original.steps.find((step) => step.name === UPLOADS[kind]);
      requireRecovery(
        Number.isSafeInteger(artifact.id) &&
          artifact.id > 0 &&
          artifact.expired === false &&
          timestamp(artifact.expires_at) &&
          Date.parse(artifact.expires_at) > now &&
          timestamp(artifact.created_at) &&
          Date.parse(artifact.created_at) >= Date.parse(upload.started_at) &&
          Date.parse(artifact.created_at) <= Date.parse(upload.completed_at) &&
          artifact.workflow_run?.id === Number(request.runId) &&
          artifact.workflow_run.head_sha === original.run.head_sha &&
          artifact.workflow_run.repository_id === original.run.repository.id &&
          artifact.workflow_run.head_repository_id === original.run.head_repository.id &&
          artifact.workflow_run.head_branch === 'main' &&
          Number.isSafeInteger(artifact.size_in_bytes) &&
          artifact.size_in_bytes > 0 &&
          artifact.size_in_bytes <= 600_000_000 &&
          /^sha256:[a-f0-9]{64}$/u.test(artifact.digest ?? ''),
        'expired, unbound or unauthenticated ' + kind + ' artifact',
      );
      return [kind, artifact];
    }),
  );
}

export function verifyArtifactBytes(artifact, bytes) {
  requireRecovery(
    bytes.length === artifact.size_in_bytes && 'sha256:' + digest(bytes) === artifact.digest,
    'artifact archive size or digest mismatch',
  );
  return bytes;
}

export function originalReceiptContext(request) {
  return {
    repository: REPOSITORY,
    workflow: REPOSITORY + '/' + ORIGINAL_WORKFLOW + '@refs/heads/main',
    sourceSha: request.sourceSha,
    runId: request.runId,
    runAttempt: request.runAttempt,
  };
}
