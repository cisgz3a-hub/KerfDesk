import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FULL_SHA = /^[0-9a-f]{40}$/iu;

export function resolveWebDeployIdentity({ eventName, checkoutSha, currentMainSha, validatedSha }) {
  const checkout = normalizedSha(checkoutSha, 'checked-out SHA');
  const currentMain = normalizedSha(currentMainSha, 'current main SHA');

  if (eventName === 'workflow_run') {
    const validated = normalizedSha(validatedSha, 'CI-validated SHA');
    if (checkout !== validated) {
      throw new Error(`Checked-out SHA ${checkout} does not match CI-validated SHA ${validated}.`);
    }
    if (checkout !== currentMain) {
      return {
        eligible: false,
        sha: checkout,
        reason: `Validated commit ${checkout} is obsolete; current main is ${currentMain}.`,
      };
    }
    return {
      eligible: true,
      sha: checkout,
      reason: 'CI-validated commit is still the current main tip.',
    };
  }

  if (eventName === 'workflow_dispatch') {
    if (checkout !== currentMain) {
      return {
        eligible: false,
        sha: checkout,
        reason: `Manual checkout ${checkout} is obsolete; current main is ${currentMain}.`,
      };
    }
    return {
      eligible: true,
      sha: checkout,
      reason: 'Manual dispatch checked out the current main tip.',
    };
  }

  throw new Error(`Unsupported deployment event: ${eventName}`);
}

function normalizedSha(value, label) {
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

function runCli() {
  const result = resolveWebDeployIdentity({
    eventName: argument('event-name'),
    checkoutSha: argument('checkout-sha'),
    currentMainSha: argument('current-main-sha'),
    validatedSha: argument('validated-sha'),
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
