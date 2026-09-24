import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveWebDeployIdentity } from './resolve-web-deploy-identity.mjs';

const oldSha = '1'.repeat(40);
const currentSha = '2'.repeat(40);
const middleSha = '3'.repeat(40);
const unrelatedSha = '4'.repeat(40);
const resolverCli = fileURLToPath(new URL('./resolve-web-deploy-identity.mjs', import.meta.url));

// A workflow_run candidate main has moved past, still on main, with every
// lookup present and nothing newer verified or reverted.
function movedPastCandidate(overrides = {}) {
  return {
    eventName: 'workflow_run',
    phase: 'candidate',
    checkoutSha: oldSha,
    currentMainSha: currentSha,
    validatedSha: oldSha,
    checkoutOnMain: true,
    newerMainCommits: [currentSha, middleSha],
    verifiedShas: [],
    revertedInCandidate: [],
    ...overrides,
  };
}

function movedPastPublication(overrides = {}) {
  return {
    eventName: 'workflow_run',
    phase: 'publication',
    checkoutSha: oldSha,
    currentMainSha: currentSha,
    validatedSha: oldSha,
    checkoutOnMain: true,
    revertedInCandidate: [],
    ...overrides,
  };
}

test('accepts the exact current main commit validated by CI', () => {
  assert.deepEqual(
    resolveWebDeployIdentity({
      eventName: 'workflow_run',
      checkoutSha: currentSha,
      currentMainSha: currentSha,
      validatedSha: currentSha,
    }),
    {
      eligible: true,
      sha: currentSha,
      reason: 'CI-validated commit is still the current main tip.',
    },
  );
});

test('turns an old successful CI rerun into a non-publishing no-op', () => {
  // Any rerun of a historical commit finds newer commits on main that already
  // passed CI or were published; the newest of them publishes, not the rerun.
  assert.deepEqual(resolveWebDeployIdentity(movedPastCandidate({ verifiedShas: [middleSha] })), {
    eligible: false,
    sha: oldSha,
    reason: `Validated commit ${oldSha} is superseded: ${middleSha}, newer on main, already passed CI or was published, and its own run publishes it. Current main is ${currentSha}.`,
  });
});

// ADR-360: the candidate phase starved exactly as the publication phase had.
// CI verifies one main commit at a time and takes ~35-85 minutes, so any merge
// during a run left the verified commit behind the tip, and the deploy recorded
// an obsolete no-op (three in a row on 2026-09-23 while ten commits merged).
test('builds a commit main has moved past while no newer commit on main has passed CI', () => {
  // Older commits' runs and unrelated SHAs never count as newer.
  const verdict = resolveWebDeployIdentity(
    movedPastCandidate({ verifiedShas: [oldSha, unrelatedSha] }),
  );

  assert.equal(verdict.eligible, true);
  assert.match(verdict.reason, /newest verified commit on main/u);
});

test('does not build a candidate that has left main', () => {
  const verdict = resolveWebDeployIdentity(
    movedPastCandidate({
      checkoutOnMain: false,
      newerMainCommits: undefined,
      verifiedShas: undefined,
      revertedInCandidate: undefined,
    }),
  );

  assert.equal(verdict.eligible, false);
  assert.match(verdict.reason, /is not on main/u);
});

// A revert adds a commit rather than removing one, so the reverted tree is
// still an ancestor of main. Under the tip-only rule it could never build.
test('does not build or publish a candidate main has since reverted', () => {
  const candidate = resolveWebDeployIdentity(
    movedPastCandidate({ revertedInCandidate: [middleSha] }),
  );
  const publication = resolveWebDeployIdentity(
    movedPastPublication({ revertedInCandidate: [oldSha] }),
  );

  assert.equal(candidate.eligible, false);
  assert.match(candidate.reason, new RegExp(`Main has since reverted ${middleSha}`, 'u'));
  assert.match(candidate.reason, /not built/u);
  assert.equal(publication.eligible, false);
  assert.match(publication.reason, /not published/u);
});

test('a candidate main has moved past needs every input explicitly, never a default', () => {
  assert.throws(
    () => resolveWebDeployIdentity(movedPastCandidate({ checkoutOnMain: undefined })),
    /checkout-on-main is not a boolean/u,
  );
  assert.throws(
    () => resolveWebDeployIdentity(movedPastCandidate({ revertedInCandidate: undefined })),
    /reverted commits must be provided as a list/u,
  );
  assert.throws(
    () => resolveWebDeployIdentity(movedPastCandidate({ newerMainCommits: undefined })),
    /newer main commits must be provided as a list/u,
  );
  assert.throws(
    () => resolveWebDeployIdentity(movedPastCandidate({ verifiedShas: undefined })),
    /verified SHAs must be provided as a list/u,
  );
  assert.throws(
    () => resolveWebDeployIdentity(movedPastCandidate({ verifiedShas: ['abc123'] })),
    /verified SHAs entry is not a full git SHA/u,
  );
  assert.throws(
    () => resolveWebDeployIdentity(movedPastPublication({ revertedInCandidate: undefined })),
    /reverted commits must be provided as a list/u,
  );
});

test('the CLI reads the lists the workflow writes and refuses a lookup it skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-identity-'));
  const run = (files) =>
    execFileSync(
      process.execPath,
      [
        resolverCli,
        '--event-name=workflow_run',
        '--phase=candidate',
        `--checkout-sha=${oldSha}`,
        `--current-main-sha=${currentSha}`,
        `--validated-sha=${oldSha}`,
        '--checkout-on-main=true',
        `--newer-main-commits-file=${join(dir, 'newer.txt')}`,
        `--verified-shas-file=${join(dir, 'verified.txt')}`,
        `--reverted-in-candidate-file=${join(dir, 'reverted.txt')}`,
        ...files,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  try {
    const output = join(dir, 'github-output.txt');
    writeFileSync(join(dir, 'newer.txt'), `${currentSha}\r\n${middleSha}\r\n`);
    writeFileSync(join(dir, 'verified.txt'), '');
    writeFileSync(join(dir, 'reverted.txt'), '');

    assert.equal(JSON.parse(run([`--github-output=${output}`])).eligible, true);
    assert.match(readFileSync(output, 'utf8'), /^eligible=true\nsha=1{40}\nreason=/u);

    writeFileSync(join(dir, 'verified.txt'), `${middleSha}\n`);
    assert.equal(JSON.parse(run([])).eligible, false);

    // A lookup the workflow skipped leaves no file; the verdict needs it, so
    // the step fails instead of reading "nothing newer is verified".
    rmSync(join(dir, 'verified.txt'));
    assert.throws(() => run([]), /verified SHAs must be provided as a list/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the tip needs no lookup files at all', () => {
  const stdout = execFileSync(
    process.execPath,
    [
      resolverCli,
      '--event-name=workflow_run',
      '--phase=candidate',
      `--checkout-sha=${currentSha}`,
      `--current-main-sha=${currentSha}`,
      `--validated-sha=${currentSha}`,
      '--checkout-on-main=true',
      '--newer-main-commits-file=does-not-exist.txt',
      '--verified-shas-file=does-not-exist.txt',
      '--reverted-in-candidate-file=does-not-exist.txt',
    ],
    { encoding: 'utf8' },
  );

  assert.equal(JSON.parse(stdout).eligible, true);
});

test('manual dispatch can build only its checked-out current main tip', () => {
  assert.equal(
    resolveWebDeployIdentity({
      eventName: 'workflow_dispatch',
      checkoutSha: currentSha,
      currentMainSha: currentSha,
    }).eligible,
    true,
  );
  // Main moved while the dispatch queued: it checked out the tree it was
  // dispatched on, which is no longer the tip, so it builds nothing.
  assert.equal(
    resolveWebDeployIdentity({
      eventName: 'workflow_dispatch',
      checkoutSha: oldSha,
      currentMainSha: currentSha,
    }).eligible,
    false,
  );
});

// The behaviour this lane was losing: the gate runs ~50 minutes while main
// merges every ~60-85, so a tip test before publication starved production
// onto a commit OLDER than the one each run kept refusing.
test('publishes a verified commit that main has advanced past, as long as it is still on main', () => {
  const candidate = resolveWebDeployIdentity({
    eventName: 'workflow_run',
    phase: 'candidate',
    checkoutSha: oldSha,
    currentMainSha: oldSha,
    validatedSha: oldSha,
  });
  const publication = resolveWebDeployIdentity(movedPastPublication());

  assert.equal(candidate.eligible, true);
  assert.equal(publication.eligible, true);
  assert.match(publication.reason, /still on main, so it publishes/u);
});

test('refuses to publish a verified commit that has left main', () => {
  const publication = resolveWebDeployIdentity(movedPastPublication({ checkoutOnMain: false }));

  assert.equal(publication.eligible, false);
  assert.match(publication.reason, /has left main/u);
});

test('still refuses a superseded candidate before any build runs', () => {
  assert.equal(
    resolveWebDeployIdentity(
      movedPastCandidate({ newerMainCommits: [currentSha], verifiedShas: [currentSha] }),
    ).eligible,
    false,
  );
});

test('a publication verdict needs an explicit on-main answer, never a guess', () => {
  for (const checkoutOnMain of [undefined, '', 'yes', '1', 'on']) {
    assert.throws(
      () => resolveWebDeployIdentity(movedPastPublication({ checkoutOnMain })),
      /checkout-on-main is not a boolean/u,
      `expected ${JSON.stringify(checkoutOnMain)} to be rejected`,
    );
  }
});

test('tolerates the case and stray whitespace a shell variable can carry', () => {
  assert.equal(
    resolveWebDeployIdentity(movedPastPublication({ checkoutOnMain: 'TRUE ' })).eligible,
    true,
  );
});

test('accepts the string booleans the workflow actually passes', () => {
  assert.equal(
    resolveWebDeployIdentity(movedPastPublication({ checkoutOnMain: 'true' })).eligible,
    true,
  );
  assert.equal(
    resolveWebDeployIdentity(movedPastPublication({ checkoutOnMain: 'false' })).eligible,
    false,
  );
});

test('rejects an unknown phase rather than defaulting to a publish', () => {
  assert.throws(
    () => resolveWebDeployIdentity(movedPastCandidate({ phase: 'publish' })),
    /Unsupported deployment phase/u,
  );
});

test('rejects a workflow-run checkout that differs from the CI-validated SHA', () => {
  assert.throws(
    () =>
      resolveWebDeployIdentity({
        eventName: 'workflow_run',
        checkoutSha: currentSha,
        currentMainSha: currentSha,
        validatedSha: oldSha,
      }),
    /does not match CI-validated SHA/u,
  );
});
