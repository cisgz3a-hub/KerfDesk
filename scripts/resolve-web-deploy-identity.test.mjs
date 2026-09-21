import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWebDeployIdentity } from './resolve-web-deploy-identity.mjs';

const oldSha = '1'.repeat(40);
const currentSha = '2'.repeat(40);

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
  assert.deepEqual(
    resolveWebDeployIdentity({
      eventName: 'workflow_run',
      checkoutSha: oldSha,
      currentMainSha: currentSha,
      validatedSha: oldSha,
    }),
    {
      eligible: false,
      sha: oldSha,
      reason: `Validated commit ${oldSha} is obsolete; current main is ${currentSha}.`,
    },
  );
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

test('still refuses an obsolete candidate before any build runs', () => {
  assert.equal(
    resolveWebDeployIdentity({
      eventName: 'workflow_run',
      phase: 'candidate',
      checkoutSha: oldSha,
      currentMainSha: currentSha,
      validatedSha: oldSha,
      checkoutOnMain: true,
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
