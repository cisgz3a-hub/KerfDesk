import assert from 'node:assert/strict';
import test from 'node:test';
import {
  manualPublicationFailure,
  parseManualPublicationArguments,
  requireManualPublicationContext,
} from './publish-manual-commercial-release.mjs';
import { CommercialReleaseError } from './commercial-release-manifest.mjs';
import { ReleaseRateLimitError, ReleaseStorageError } from './stable-release-store.mjs';

test('manual publisher requires explicit reviewed latest metadata and exactly three paths', () => {
  assert.deepEqual(
    parseManualPublicationArguments([
      '--expected-latest-sha256',
      'none',
      'release',
      'identity.json',
      'resources',
    ]),
    {
      expectedLatestSha256: 'none',
      releaseDirectory: 'release',
      identityPath: 'identity.json',
      resourcesDirectory: 'resources',
    },
  );
  assert.equal(
    parseManualPublicationArguments([
      '--reviewed-history',
      'reviewed-history.json',
      '--expected-latest-sha256',
      'a'.repeat(64),
      'release',
      'identity.json',
      'resources',
    ]).reviewedHistoryPath,
    'reviewed-history.json',
  );
  for (const args of [
    [],
    ['release', 'identity', 'resources'],
    ['--expected-latest-sha256', 'bad', 'release', 'identity', 'resources'],
    ['--expected-latest-sha256', 'none', '--extra', 'identity', 'resources'],
    ['--expected-latest-sha256', 'none', 'release', 'identity', 'resources', '--reviewed-history'],
    [
      '--expected-latest-sha256',
      'none',
      '--reviewed-history',
      '--extra',
      'release',
      'identity',
      'resources',
    ],
    [
      '--expected-latest-sha256',
      'none',
      '--reviewed-history',
      'one.json',
      '--reviewed-history',
      'two.json',
      'release',
      'identity',
      'resources',
    ],
  ])
    assert.throws(() => parseManualPublicationArguments(args), /Usage/u);
});

test('manual publication requires explicit stable-key and Windows context without native signing credentials', () => {
  const env = {
    DESKTOP_STABLE_MANIFEST_PRIVATE_KEY: 'synthetic-test-key',
    DESKTOP_STABLE_MANIFEST_KEY_ID: 'test-stable',
    COMMERCIAL_R2_API_TOKEN: 'synthetic-r2-token',
    COMMERCIAL_CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  };
  assert.doesNotThrow(() => requireManualPublicationContext(env, 'win32'));
  assert.throws(() => requireManualPublicationContext(env, 'linux'));
  for (const field of Object.keys(env))
    assert.throws(() => requireManualPublicationContext({ ...env, [field]: '' }, 'win32'));
});

test('manual publisher surfaces typed storage failures without raw credentials or provider text', () => {
  const secret = 'synthetic-secret-token-provider-text';
  const env = { COMMERCIAL_R2_API_TOKEN: secret };
  const failure = new ReleaseStorageError('list', 'http', 403);
  failure.message = `https://provider.invalid/${secret}`;
  failure.stack = secret;
  failure.cause = new Error(secret);
  assert.equal(manualPublicationFailure(failure, env), 'Release storage list failed: HTTP 403.');
  assert.equal(
    manualPublicationFailure(new ReleaseStorageError('list', 'pagination'), env),
    'Release storage list failed: invalid or incomplete listing pagination.',
  );
  assert.equal(
    manualPublicationFailure(new ReleaseRateLimitError(secret), env),
    'Release storage operation failed: HTTP 429.',
  );
  assert.equal(
    manualPublicationFailure(new CommercialReleaseError('Reviewed history is incomplete.'), env),
    'Reviewed history is incomplete.',
  );
  const fallback = manualPublicationFailure(new Error(secret), env);
  assert.match(fallback, /^Manual commercial publication failed\./u);
  for (const error of [
    new Error(`https://provider.invalid/${secret}`),
    new CommercialReleaseError(`Invalid release: ${secret}`),
    new CommercialReleaseError('Invalid release: https://provider.invalid/raw-response'),
    { name: 'ReleaseStorageError', message: secret, stack: secret },
  ])
    assert.equal(manualPublicationFailure(error, env), fallback);
});
