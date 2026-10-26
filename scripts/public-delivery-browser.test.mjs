import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSON_SCHEMA, load } from 'js-yaml';
import { launchPublicDeliveryBrowser } from './public-delivery-browser.mjs';

test('delivery uses the managed browser only when explicitly provisioned, retaining the local Chrome default', async () => {
  for (const [env, expectedChannel] of [
    [{ KERFDESK_TEST_BROWSER: 'chromium' }, undefined],
    [{}, 'chrome'],
  ]) {
    const launched = {};
    const calls = [];
    const browser = await launchPublicDeliveryBrowser({
      env,
      chromium: {
        launch: async (options) => {
          calls.push(options);
          return launched;
        },
      },
    });
    assert.equal(browser, launched);
    assert.deepEqual(calls, [
      {
        ...(expectedChannel ? { channel: expectedChannel } : {}),
        headless: true,
        timeout: 30_000,
      },
    ]);
  }
});

test('a failed managed-browser launch propagates without trying an unqualified fallback', async () => {
  const failure = new Error('browser startup failed');
  let launches = 0;
  await assert.rejects(
    launchPublicDeliveryBrowser({
      env: { KERFDESK_TEST_BROWSER: 'chromium' },
      chromium: {
        launch: async () => {
          launches += 1;
          throw failure;
        },
      },
    }),
    (error) => error === failure,
  );
  assert.equal(launches, 1);
});

test('Windows installs the locked browser before building and probes the shared launcher before publication', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.ok(
    packageJson.scripts['test:release-integrity']
      .split(/\s+/u)
      .includes('scripts/public-delivery-browser.test.mjs'),
  );
  const workflow = load(
    await readFile(
      new URL('../.github/workflows/release-desktop-unsigned.yml', import.meta.url),
      'utf8',
    ),
    { schema: JSON_SCHEMA },
  );
  const { env, steps } = workflow.jobs.publish;
  assert.equal(env.KERFDESK_TEST_BROWSER, 'chromium');
  const install = steps.findIndex((step) =>
    step.run?.includes('pnpm exec playwright install chromium'),
  );
  const build = steps.findIndex(
    (step) => step.name === 'Build the desktop source that passed the required checks',
  );
  const probe = steps.findIndex(
    (step) => step.name === 'Verify delivery browser is available before publication',
  );
  const publication = steps.findIndex((step) => step.id === 'publish-windows');
  assert.ok(install >= 0 && install < build && build < probe && probe < publication);
  for (const index of [install, probe]) {
    assert.match(steps[index].run, /node scripts\/public-delivery-browser\.mjs/u);
    assert.equal(steps[index].if, "steps.plan.outputs.publish == 'true'");
    assert.notEqual(steps[index]['continue-on-error'], true);
  }
  assert.match(steps[install].run, /if \(\$LASTEXITCODE -ne 0\) \{ throw/u);
  const verifier = await readFile(
    new URL('./verify-public-desktop-release.mjs', import.meta.url),
    'utf8',
  );
  assert.match(
    verifier,
    /import \{ launchPublicDeliveryBrowser \} from '\.\/public-delivery-browser\.mjs'/u,
  );
  assert.match(verifier, /const browser = await launchPublicDeliveryBrowser\(\)/u);
  assert.doesNotMatch(verifier, /chromium\.launch/u);
});
