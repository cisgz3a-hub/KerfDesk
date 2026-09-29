import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

// A deploy from wrangler.jsonc replaces every plain-text variable set in the
// dashboard, so whatever the live Worker needs must be in the file. Read it the
// way `wrangler deploy` does.
const { unstable_readConfig: readConfig } = await import('wrangler');

function deployConfig() {
  return readConfig(
    { config: fileURLToPath(new URL('./wrangler.jsonc', import.meta.url)) },
    { hideWarnings: true },
  );
}

test('a redeploy keeps the signing key ID the desktop app trusts', async () => {
  const pinned = JSON.parse(
    await readFile(new URL('../../public/desktop-licence-keys.json', import.meta.url), 'utf8'),
  );
  const keyId = deployConfig().vars.SIGNING_KEY_ID;
  assert.ok(
    pinned.keys.some((key) => key.keyId === keyId),
    `SIGNING_KEY_ID ${keyId} is not a key in public/desktop-licence-keys.json`,
  );
});

test('a redeploy keeps the durable object and rate limiter the live data depends on', () => {
  const config = deployConfig();
  assert.deepEqual(config.durable_objects.bindings, [
    { name: 'LICENSE_AUTHORITY', class_name: 'LicenseAuthority' },
  ]);
  assert.deepEqual(config.migrations, [{ tag: 'v1', new_sqlite_classes: ['LicenseAuthority'] }]);
  const requests = config.ratelimits.find((limiter) => limiter.name === 'REQUEST_RATE_LIMITER');
  assert.equal(requests?.namespace_id, '1001');
});
