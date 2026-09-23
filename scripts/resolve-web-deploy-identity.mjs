import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FULL_SHA = /^[0-9a-f]{40}$/iu;
const PHASES = new Set(['candidate', 'publication']);
const PRODUCTION_RELATIONS = new Set(['older', 'same', 'other']);

/**
 * The deploy lane asks this twice, and the two phases ask DIFFERENT questions.
 *
 * `candidate` (before the build): is this commit worth building at all? Main's
 * tip always is. A commit main has moved past is worth building only while
 * nothing supersedes it: no newer commit on main has passed CI (that commit's
 * own run is queued behind this one) and production serves an ancestor of it
 * (`web-deploy-lane-evidence.mjs` gathers both). An obsolete historical rerun
 * fails both tests and never burns a build slot.
 *
 * `publication` (after the build): is this commit still safe to publish? It is,
 * as long as it has not LEFT main — a newer tip is not a reason to withhold it.
 *
 * Requiring the tip is what starved the lane, first at publication (ADR-311
 * Amendment 1) and then at the candidate phase (Amendment 2). CI runs for tens
 * of minutes; when main merged again before it finished, the run found its
 * commit behind the tip and built nothing, and the newer commit's CI was then
 * overtaken by the next merge in turn. The site sat on a commit hours older
 * than the ones each run refused — the freshness check made the site staler,
 * which is the opposite of its job.
 *
 * Production can therefore trail main by a commit or two; the newer commit
 * publishes from its own queued run, and the concurrency lane (`queue: max`)
 * keeps those runs in order.
 */
export function resolveWebDeployIdentity({
  eventName,
  phase = 'candidate',
  checkoutSha,
  currentMainSha,
  validatedSha,
  checkoutOnMain,
  laneEvidence,
}) {
  const checkout = normalizedSha(checkoutSha, 'checked-out SHA');
  const currentMain = normalizedSha(currentMainSha, 'current main SHA');
  if (!PHASES.has(phase)) throw new Error(`Unsupported deployment phase: ${phase}`);
  assertKnownEvent(eventName, checkout, validatedSha);

  if (checkout === currentMain) {
    return { eligible: true, sha: checkout, reason: tipReason(eventName) };
  }
  if (phase === 'publication') return publicationVerdict(checkout, currentMain, checkoutOnMain);
  return candidateVerdict(eventName, checkout, currentMain, laneFacts(laneEvidence));
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

function candidateVerdict(eventName, checkout, currentMain, lane) {
  const subject = `${eventName === 'workflow_run' ? 'Validated commit' : 'Manual checkout'} ${checkout}`;
  const behind = `${subject} is behind current main ${currentMain}`;
  const skip = (reason) => ({ eligible: false, sha: checkout, reason });
  if (lane.unavailable !== null) {
    return skip(
      `${behind}, and the lane evidence is unavailable (${lane.unavailable}), so it does not build.`,
    );
  }
  if (!lane.candidateOnMain) {
    return skip(
      `${subject} is no longer on main (current main is ${currentMain}), so it does not build.`,
    );
  }
  if (lane.newerValidatedSha !== null) {
    return skip(
      `${behind} and superseded: ${lane.newerValidatedSha} already passed CI and deploys from its own run.`,
    );
  }
  if (lane.productionSha === null) {
    return skip(
      `${behind}, and the commit production serves is unknown (${lane.productionEvidence}), so it does not build.`,
    );
  }
  if (lane.productionRelation === 'same') {
    return skip(`${behind}, and production already serves it.`);
  }
  if (lane.productionRelation === 'other') {
    return skip(
      `${behind}, and production serves ${lane.productionSha}, which it does not descend from.`,
    );
  }
  return {
    eligible: true,
    sha: checkout,
    reason: `${behind}, but no newer commit has passed CI and production serves the older ${lane.productionSha}, so it builds; newer commits deploy from their own runs.`,
  };
}

// Only well-formed evidence can widen what builds: a malformed field throws,
// exactly as `--checkout-on-main` does, while a lookup the evidence script
// could not make arrives as `unavailable` and keeps the tip-only rule.
function laneFacts(evidence) {
  if (evidence === null || typeof evidence !== 'object') {
    throw new Error("Lane evidence is required for a candidate that is not main's tip.");
  }
  if (evidence.unavailable !== null && evidence.unavailable !== undefined) {
    const unavailable = singleLine(evidence.unavailable);
    if (unavailable === '')
      throw new Error('Lane evidence is marked unavailable without a reason.');
    return { unavailable };
  }
  const productionSha = optionalSha(evidence.productionSha, 'production SHA');
  const productionRelation = productionSha === null ? null : evidence.productionRelation;
  if (productionSha !== null && !PRODUCTION_RELATIONS.has(productionRelation)) {
    throw new Error(`production relation is not older, same or other: ${productionRelation}`);
  }
  return {
    unavailable: null,
    candidateOnMain: parsedBoolean(evidence.candidateOnMain, 'candidate-on-main'),
    newerValidatedSha: optionalSha(evidence.newerValidatedSha, 'newer validated SHA'),
    productionSha,
    productionRelation,
    productionEvidence: singleLine(evidence.productionEvidence ?? 'no record') || 'no record',
  };
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

function optionalSha(value, label) {
  return value === null || value === undefined ? null : normalizedSha(value, label);
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

// A reason lands in GITHUB_OUTPUT as one `reason=` line.
function singleLine(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function runCli() {
  const laneEvidencePath = argument('lane-evidence');
  const result = resolveWebDeployIdentity({
    eventName: argument('event-name'),
    phase: argument('phase') ?? 'candidate',
    checkoutSha: argument('checkout-sha'),
    currentMainSha: argument('current-main-sha'),
    validatedSha: argument('validated-sha'),
    checkoutOnMain: argument('checkout-on-main'),
    laneEvidence:
      laneEvidencePath === undefined
        ? undefined
        : JSON.parse(readFileSync(resolve(laneEvidencePath), 'utf8')),
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
