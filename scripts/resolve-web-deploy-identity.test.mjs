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

test('manual dispatch can publish only its checked-out current main tip', () => {
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

test('a second freshness check cancels publication when main advances during the build', () => {
  const firstCheck = resolveWebDeployIdentity({
    eventName: 'workflow_run',
    checkoutSha: oldSha,
    currentMainSha: oldSha,
    validatedSha: oldSha,
  });
  const prePublishCheck = resolveWebDeployIdentity({
    eventName: 'workflow_run',
    checkoutSha: oldSha,
    currentMainSha: currentSha,
    validatedSha: oldSha,
  });

  assert.equal(firstCheck.eligible, true);
  assert.equal(prePublishCheck.eligible, false);
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
