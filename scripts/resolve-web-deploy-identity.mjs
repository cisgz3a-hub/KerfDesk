import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FULL_SHA = /^[0-9a-f]{40}$/iu;
const PHASES = new Set(['candidate', 'publication']);

/**
 * The deploy lane asks this twice, and the two phases ask DIFFERENT questions.
 *
 * `candidate` (before the build): is this commit worth building at all? Only
 * main's tip is, so an obsolete historical rerun never burns a build slot.
 *
 * `publication` (after the build): is this commit still safe to publish? It is,
 * as long as it has not LEFT main — a newer tip is not a reason to withhold it.
 *
 * Requiring the tip in BOTH phases is what starved the lane. The verification
 * gate runs ~50 minutes while main merges every ~60-85, so nearly every run
 * lost the race and skipped publication while still reporting success. The site
 * then sat on a commit far OLDER than the one each run was refusing to publish
 * — the freshness check made the site staler, which is the opposite of its job.
 *
 * Publishing an ancestor of the current tip means production can trail main by
 * a commit or two; the newer commit publishes from its own queued run, and the
 * concurrency lane (`queue: max`) keeps those runs in order.
 */
export function resolveWebDeployIdentity({
  eventName,
  phase = 'candidate',
  checkoutSha,
  currentMainSha,
  validatedSha,
  checkoutOnMain,
}) {
  const checkout = normalizedSha(checkoutSha, 'checked-out SHA');
  const currentMain = normalizedSha(currentMainSha, 'current main SHA');
  if (!PHASES.has(phase)) throw new Error(`Unsupported deployment phase: ${phase}`);
  assertKnownEvent(eventName, checkout, validatedSha);

  if (checkout === currentMain) {
    return { eligible: true, sha: checkout, reason: tipReason(eventName) };
  }
  if (phase === 'publication') return publicationVerdict(checkout, currentMain, checkoutOnMain);
  return {
    eligible: false,
    sha: checkout,
    reason: obsoleteReason(eventName, checkout, currentMain),
  };
}

function assertKnownEvent(eventName, checkout, validatedSha) {
  if (eventName === 'workflow_dispatch') return;
  if (eventName !== 'workflow_run') {
    throw new Error(`Unsupported deployment event: ${eventName}`);
  }
  // The trigger promises CI validated THIS tree; a mismatch means the lane is
  // about to publish something no suite ever saw.
  const validated = normalizedSha(validatedSha, 'CI-validated SHA');
  if (checkout !== validated) {
    throw new Error(`Checked-out SHA ${checkout} does not match CI-validated SHA ${validated}.`);
  }
}

function tipReason(eventName) {
  return eventName === 'workflow_run'
    ? 'CI-validated commit is still the current main tip.'
    : 'Manual dispatch checked out the current main tip.';
}

function obsoleteReason(eventName, checkout, currentMain) {
  return eventName === 'workflow_run'
    ? `Validated commit ${checkout} is obsolete; current main is ${currentMain}.`
    : `Manual checkout ${checkout} is obsolete; current main is ${currentMain}.`;
}

function publicationVerdict(checkout, currentMain, checkoutOnMain) {
  if (!parsedBoolean(checkoutOnMain, 'checkout-on-main')) {
    return {
      eligible: false,
      sha: checkout,
      reason: `Verified commit ${checkout} has left main (current main is ${currentMain}); it was reverted, rebased away, or force-pushed over, so it is not published.`,
    };
  }
  return {
    eligible: true,
    sha: checkout,
    reason: `Main advanced to ${currentMain} during verification, but ${checkout} is still on main, so it publishes; the newer commit deploys from its own run.`,
  };
}

function normalizedSha(value, label) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!FULL_SHA.test(normalized)) throw new Error(`${label} is not a full git SHA: ${value}`);
  return normalized;
}

// Only the two literals, because an unrecognised value here would otherwise
// decide a production publication by accident.
function parsedBoolean(value, label) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${label} is not a boolean: ${value}`);
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function runCli() {
  const result = resolveWebDeployIdentity({
    eventName: argument('event-name'),
    phase: argument('phase') ?? 'candidate',
    checkoutSha: argument('checkout-sha'),
    currentMainSha: argument('current-main-sha'),
    validatedSha: argument('validated-sha'),
    checkoutOnMain: argument('checkout-on-main'),
  });
  const githubOutput = argument('github-output');
  if (githubOutput !== undefined) {
    appendFileSync(
      resolve(githubOutput),
      `eligible=${String(result.eligible)}\nsha=${result.sha}\nreason=${result.reason}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`web deployment identity failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
