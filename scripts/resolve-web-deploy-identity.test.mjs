import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveWebDeployIdentity } from './resolve-web-deploy-identity.mjs';

const productionSha = '0'.repeat(40);
const oldSha = '1'.repeat(40);
const currentSha = '2'.repeat(40);

/** Lane evidence for `oldSha`: on main, nothing newer passed CI, production older. */
function laneEvidence(overrides = {}) {
  return {
    unavailable: null,
    candidateOnMain: true,
    newerValidatedSha: null,
    productionSha,
    productionRelation: 'older',
    productionEvidence: 'deploy run 7 published it',
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return resolveWebDeployIdentity({
    eventName: 'workflow_run',
    phase: 'candidate',
    checkoutSha: oldSha,
    currentMainSha: currentSha,
    validatedSha: oldSha,
    laneEvidence: laneEvidence(),
    ...overrides,
  });
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

// A rerun of an old green CI: the commits after it passed CI too, and
// production already serves one of them.
test('turns an old successful CI rerun into a non-publishing no-op', () => {
  assert.deepEqual(
    candidate({
      laneEvidence: laneEvidence({
        newerValidatedSha: currentSha,
        productionSha: currentSha,
        productionRelation: 'other',
      }),
    }),
    {
      eligible: false,
      sha: oldSha,
      reason: `Validated commit ${oldSha} is behind current main ${currentSha} and superseded: ${currentSha} already passed CI and deploys from its own run.`,
    },
  );
});

test('manual dispatch builds its checked-out tip; a raced checkout follows the candidate rules', () => {
  assert.equal(
    resolveWebDeployIdentity({
      eventName: 'workflow_dispatch',
      checkoutSha: currentSha,
      currentMainSha: currentSha,
    }).eligible,
    true,
  );
  const raced = resolveWebDeployIdentity({
    eventName: 'workflow_dispatch',
    checkoutSha: oldSha,
    currentMainSha: currentSha,
    laneEvidence: laneEvidence({ newerValidatedSha: currentSha }),
  });
  assert.equal(raced.eligible, false);
  assert.match(raced.reason, /^Manual checkout 1{40} is behind current main/u);
});

// The starvation of 2026-09-23: CI validated a commit, main merged again
// before CI finished, and the newer commit's CI was overtaken the same way.
// Nothing newer has passed CI, so nothing else would publish either.
test('builds a validated commit main has moved past when nothing newer passed CI', () => {
  assert.deepEqual(candidate(), {
    eligible: true,
    sha: oldSha,
    reason: `Validated commit ${oldSha} is behind current main ${currentSha}, but no newer commit has passed CI and production serves the older ${productionSha}, so it builds; newer commits deploy from their own runs.`,
  });
});

test('main tip builds without consulting lane evidence', () => {
  for (const evidence of [undefined, null, { unavailable: 'GitHub API answered 403' }]) {
    assert.equal(
      candidate({ checkoutSha: currentSha, validatedSha: currentSha, laneEvidence: evidence })
        .eligible,
      true,
    );
  }
});

test('does not build a commit production already serves or has moved past', () => {
  const same = candidate({
    laneEvidence: laneEvidence({ productionSha: oldSha, productionRelation: 'same' }),
  });
  assert.equal(same.eligible, false);
  assert.match(same.reason, /production already serves it\.$/u);

  // Newer, or on a line the candidate does not descend from (a manual
  // dispatch published main's tip while this commit's CI was still running).
  const other = candidate({
    laneEvidence: laneEvidence({ productionSha: currentSha, productionRelation: 'other' }),
  });
  assert.equal(other.eligible, false);
  assert.match(other.reason, /production serves 2{40}, which it does not descend from/u);
});

test('keeps the tip-only rule when production or the lane evidence is unknown', () => {
  const unknownProduction = candidate({
    laneEvidence: laneEvidence({
      productionSha: null,
      productionRelation: null,
      productionEvidence: 'none of the last 30 completed deploy runs published',
    }),
  });
  assert.equal(unknownProduction.eligible, false);
  assert.match(
    unknownProduction.reason,
    /production serves is unknown \(none of the last 30 completed deploy runs published\)/u,
  );

  const unavailable = candidate({
    laneEvidence: { unavailable: 'GitHub API answered 403\nfor actions/runs' },
  });
  assert.equal(unavailable.eligible, false);
  assert.match(unavailable.reason, /unavailable \(GitHub API answered 403 for actions\/runs\)/u);
});

test('does not build a candidate that has left main', () => {
  const left = candidate({ laneEvidence: laneEvidence({ candidateOnMain: false }) });
  assert.equal(left.eligible, false);
  assert.match(left.reason, /is no longer on main/u);
});

test('a candidate behind the tip needs lane evidence, never a guess', () => {
  for (const evidence of [undefined, null, 'true']) {
    assert.throws(() => candidate({ laneEvidence: evidence }), /Lane evidence is required/u);
  }
});

test('malformed lane evidence throws instead of deciding a build', () => {
  const malformed = [
    [{ candidateOnMain: 'yes' }, /candidate-on-main is not a boolean/u],
    [{ candidateOnMain: undefined }, /candidate-on-main is not a boolean/u],
    [{ newerValidatedSha: 'abc123' }, /newer validated SHA is not a full git SHA/u],
    [{ productionSha: 'main' }, /production SHA is not a full git SHA/u],
    [{ productionRelation: 'newer' }, /production relation is not older, same or other/u],
    [{ unavailable: ' ' }, /marked unavailable without a reason/u],
  ];
  for (const [override, message] of malformed) {
    assert.throws(() => candidate({ laneEvidence: laneEvidence(override) }), message);
  }
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
  const publication = resolveWebDeployIdentity({
    eventName: 'workflow_run',
    phase: 'publication',
    checkoutSha: oldSha,
    currentMainSha: currentSha,
    validatedSha: oldSha,
    checkoutOnMain: true,
  });

  assert.equal(candidate.eligible, true);
  assert.equal(publication.eligible, true);
  assert.match(publication.reason, /still on main, so it publishes/u);
});

test('refuses to publish a verified commit that has left main', () => {
  const publication = resolveWebDeployIdentity({
    eventName: 'workflow_run',
    phase: 'publication',
    checkoutSha: oldSha,
    currentMainSha: currentSha,
    validatedSha: oldSha,
    checkoutOnMain: false,
  });

  assert.equal(publication.eligible, false);
  assert.match(publication.reason, /has left main/u);
});

test('still refuses a superseded candidate before any build runs', () => {
  assert.equal(
    candidate({
      checkoutOnMain: true,
      laneEvidence: laneEvidence({ newerValidatedSha: currentSha }),
    }).eligible,
    false,
  );
});

test('a publication verdict needs an explicit on-main answer, never a guess', () => {
  for (const checkoutOnMain of [undefined, '', 'yes', '1', 'on']) {
    assert.throws(
      () =>
        resolveWebDeployIdentity({
          eventName: 'workflow_run',
          phase: 'publication',
          checkoutSha: oldSha,
          currentMainSha: currentSha,
          validatedSha: oldSha,
          checkoutOnMain,
        }),
      /checkout-on-main is not a boolean/u,
      `expected ${JSON.stringify(checkoutOnMain)} to be rejected`,
    );
  }
});

test('tolerates the case and stray whitespace a shell variable can carry', () => {
  assert.equal(
    resolveWebDeployIdentity({
      eventName: 'workflow_run',
      phase: 'publication',
      checkoutSha: oldSha,
      currentMainSha: currentSha,
      validatedSha: oldSha,
      checkoutOnMain: 'TRUE ',
    }).eligible,
    true,
  );
});

test('accepts the string booleans the workflow actually passes', () => {
  assert.equal(
    resolveWebDeployIdentity({
      eventName: 'workflow_run',
      phase: 'publication',
      checkoutSha: oldSha,
      currentMainSha: currentSha,
      validatedSha: oldSha,
      checkoutOnMain: 'true',
    }).eligible,
    true,
  );
  assert.equal(
    resolveWebDeployIdentity({
      eventName: 'workflow_run',
      phase: 'publication',
      checkoutSha: oldSha,
      currentMainSha: currentSha,
      validatedSha: oldSha,
      checkoutOnMain: 'false',
    }).eligible,
    false,
  );
});

test('rejects an unknown phase rather than defaulting to a publish', () => {
  assert.throws(
    () =>
      resolveWebDeployIdentity({
        eventName: 'workflow_run',
        phase: 'publish',
        checkoutSha: oldSha,
        currentMainSha: currentSha,
        validatedSha: oldSha,
      }),
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

// Exactly as deploy.yml invokes it: the evidence arrives as a file, and every
// value must land in GITHUB_OUTPUT as a single `key=value` line.
test('the CLI reads the lane evidence file and writes one-line outputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kerfdesk-deploy-identity-'));
  const evidencePath = join(dir, 'lane-evidence.json');
  const outputPath = join(dir, 'github-output');
  const runCli = (evidence) => {
    writeFileSync(evidencePath, JSON.stringify(evidence));
    writeFileSync(outputPath, '');
    const stdout = execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('./resolve-web-deploy-identity.mjs', import.meta.url)),
        '--event-name=workflow_run',
        '--phase=candidate',
        `--checkout-sha=${oldSha}`,
        `--current-main-sha=${currentSha}`,
        `--validated-sha=${oldSha}`,
        `--lane-evidence=${evidencePath}`,
        `--github-output=${outputPath}`,
      ],
      { encoding: 'utf8' },
    );
    return { stdout, lines: readFileSync(outputPath, 'utf8').trimEnd().split('\n') };
  };
  try {
    const refused = runCli({ unavailable: 'GitHub API answered 502\nretry later' });
    assert.equal(refused.lines.length, 3);
    assert.deepEqual(refused.lines.slice(0, 2), ['eligible=false', `sha=${oldSha}`]);
    assert.match(refused.lines[2], /^reason=.*\(GitHub API answered 502 retry later\)/u);
    assert.equal(JSON.parse(refused.stdout).eligible, false);

    const built = runCli(laneEvidence());
    assert.deepEqual(built.lines.slice(0, 2), ['eligible=true', `sha=${oldSha}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
