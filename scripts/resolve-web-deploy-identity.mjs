import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FULL_SHA = /^[0-9a-f]{40}$/iu;
const PHASES = new Set(['candidate', 'publication']);

/**
 * The deploy lane asks this twice, and the two phases ask DIFFERENT questions.
 *
 * `candidate` (before the build): is this commit worth building at all? Main's
 * tip is. So is an older commit still on main when no NEWER commit on main has
 * passed CI or been published yet: it is then the newest verified tree, and no
 * run will publish anything newer before it (ADR-360). A commit superseded by a
 * newer verified one - which is what an obsolete historical rerun always is -
 * never burns a build slot.
 *
 * `publication` (after the build): is this commit still safe to publish? It is,
 * as long as it has not LEFT main - a newer tip is not a reason to withhold it.
 *
 * In both phases, a commit main has since reverted (or that contains a commit
 * main has since reverted) is withheld: a revert adds a commit rather than
 * removing one, so the reverted tree is still "on main" (ADR-360).
 *
 * Requiring the tip is what starved the lane, twice. ADR-311 Amendment 1 removed
 * it from the publication phase. The candidate phase then starved the same way:
 * main's CI takes ~35-85 minutes and runs one commit at a time, so whenever
 * anything merged during a run, the commit it verified was no longer the tip
 * when the deploy asked, and the deploy recorded an obsolete no-op while
 * reporting success. On 2026-09-23 three such runs in a row left production on
 * one commit for four hours while ten merged.
 *
 * Publishing an ancestor of the current tip means production can trail main by
 * one CI run; the newer commit publishes from its own queued run, and the
 * concurrency lane (`queue: max`) keeps those runs in order.
 */
export function resolveWebDeployIdentity({
  eventName,
  phase = 'candidate',
  checkoutSha,
  currentMainSha,
  validatedSha,
  checkoutOnMain,
  newerMainCommits,
  verifiedShas,
  revertedInCandidate,
}) {
  const checkout = normalizedSha(checkoutSha, 'checked-out SHA');
  const currentMain = normalizedSha(currentMainSha, 'current main SHA');
  if (!PHASES.has(phase)) throw new Error(`Unsupported deployment phase: ${phase}`);
  assertKnownEvent(eventName, checkout, validatedSha);

  if (checkout === currentMain) {
    return { eligible: true, sha: checkout, reason: tipReason(eventName) };
  }
  if (phase === 'publication') {
    return publicationVerdict({ checkout, currentMain, checkoutOnMain, revertedInCandidate });
  }
  if (eventName !== 'workflow_run') {
    return {
      eligible: false,
      sha: checkout,
      reason: obsoleteReason(eventName, checkout, currentMain),
    };
  }
  return candidateVerdict({
    checkout,
    currentMain,
    checkoutOnMain,
    newerMainCommits,
    verifiedShas,
    revertedInCandidate,
  });
}

// A workflow_run candidate that main has moved past. The inputs are required,
// never defaulted: an unset list would read as "nothing newer is verified" and
// could publish an obsolete tree.
function candidateVerdict({
  checkout,
  currentMain,
  checkoutOnMain,
  newerMainCommits,
  verifiedShas,
  revertedInCandidate,
}) {
  if (!parsedBoolean(checkoutOnMain, 'checkout-on-main')) {
    return {
      eligible: false,
      sha: checkout,
      reason: `Validated commit ${checkout} is not on main (current main is ${currentMain}); it was rebased away or force-pushed over, so it is not built.`,
    };
  }
  const reverted = revertVerdict(checkout, currentMain, revertedInCandidate, 'built');
  if (reverted !== null) return reverted;
  const newer = shaList(newerMainCommits, 'newer main commits');
  const verified = new Set(shaList(verifiedShas, 'verified SHAs'));
  const supersededBy = newer.find((sha) => verified.has(sha));
  if (supersededBy !== undefined) {
    return {
      eligible: false,
      sha: checkout,
      reason: `Validated commit ${checkout} is superseded: ${supersededBy}, newer on main, already passed CI or was published, and its own run publishes it. Current main is ${currentMain}.`,
    };
  }
  return {
    eligible: true,
    sha: checkout,
    reason: `Validated commit ${checkout} is the newest verified commit on main; main moved on to ${currentMain}, whose newer commits have not passed CI yet, so this one publishes now and they publish from their own runs.`,
  };
}

// Main reverted this commit, or one it contains, after it was verified. The
// revert is newer, so its own run publishes the corrected tree.
function revertVerdict(checkout, currentMain, revertedInCandidate, action) {
  const reverted = [...new Set(shaList(revertedInCandidate, 'reverted commits'))];
  if (reverted.length === 0) return null;
  return {
    eligible: false,
    sha: checkout,
    reason: `Main has since reverted ${reverted.join(', ')}, which ${checkout} contains, so it is not ${action}; the revert publishes from its own run. Current main is ${currentMain}.`,
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

function publicationVerdict({ checkout, currentMain, checkoutOnMain, revertedInCandidate }) {
  if (!parsedBoolean(checkoutOnMain, 'checkout-on-main')) {
    return {
      eligible: false,
      sha: checkout,
      reason: `Verified commit ${checkout} has left main (current main is ${currentMain}); it was rebased away or force-pushed over, so it is not published.`,
    };
  }
  const reverted = revertVerdict(checkout, currentMain, revertedInCandidate, 'published');
  if (reverted !== null) return reverted;
  return {
    eligible: true,
    sha: checkout,
    reason: `Main advanced to ${currentMain} during verification, but ${checkout} is still on main, so it publishes; the newer commit deploys from its own run.`,
  };
}

// Newest first for `newerMainCommits` (git rev-list order); order is irrelevant
// for the other lists. Blank lines are ignored; anything else must be a full SHA.
function shaList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be provided as a list`);
  return value
    .map((entry) => String(entry).trim())
    .filter((entry) => entry !== '')
    .map((entry) => normalizedSha(entry, `${label} entry`));
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

// The workflow writes these files only when it performed the lookup. A missing
// file stays undefined, so a verdict that needs the list throws instead of
// reading a skipped lookup as "nothing newer is verified".
function linesFromFile(name) {
  const path = argument(name);
  if (path === undefined || !existsSync(resolve(path))) return undefined;
  return readFileSync(resolve(path), 'utf8').split(/\r?\n/u);
}

function runCli() {
  const result = resolveWebDeployIdentity({
    eventName: argument('event-name'),
    phase: argument('phase') ?? 'candidate',
    checkoutSha: argument('checkout-sha'),
    currentMainSha: argument('current-main-sha'),
    validatedSha: argument('validated-sha'),
    checkoutOnMain: argument('checkout-on-main'),
    newerMainCommits: linesFromFile('newer-main-commits-file'),
    verifiedShas: linesFromFile('verified-shas-file'),
    revertedInCandidate: linesFromFile('reverted-in-candidate-file'),
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
