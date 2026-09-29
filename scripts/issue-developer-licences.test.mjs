import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DEVELOPER_GRANTS,
  IssuanceError,
  issueDeveloperLicences,
  runIssuance,
} from './issue-developer-licences.mjs';

const TOKEN = 'a'.repeat(43);
const licence = (id) => `KD1.${id}.${'k'.repeat(42)}${id.length % 10}`;

function service(overrides = {}) {
  const requests = [];
  return {
    requests,
    fetcher: async (url, init) => {
      requests.push({ url, init });
      const grant = JSON.parse(init.body);
      if (overrides[grant.grantId]) return overrides[grant.grantId]();
      const licenseId = `${grant.grantId}-0000-licence`;
      return Response.json({
        licenseId,
        licenseKey: licence(licenseId),
        displayName: grant.displayName,
      });
    },
  };
}

async function sandbox(t) {
  const base = await mkdtemp(join(tmpdir(), 'kerfdesk-grants-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = join(base, 'repo');
  const vault = join(base, 'vault');
  await mkdir(repo);
  await mkdir(vault);
  return { repo, vault };
}

test('issues exactly the two named developer grants and writes them privately', async (t) => {
  const { repo, vault } = await sandbox(t);
  const server = service();
  const output = join(vault, 'developer-licences.json');
  const result = await issueDeveloperLicences(
    { tokenText: `${TOKEN}\n`, output },
    server.fetcher,
    repo,
  );
  assert.deepEqual(result.names, ['Johann', 'Father']);
  assert.deepEqual(
    server.requests.map((request) => JSON.parse(request.init.body)),
    DEVELOPER_GRANTS.map((grant) => ({ ...grant })),
  );
  for (const { url, init } of server.requests) {
    assert.equal(url, 'https://license.kerfdesk.com/v1/admin/developer-grants');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal('Origin' in init.headers, false);
  }
  const saved = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(
    saved.grants.map((grant) => [grant.grantId, grant.displayName]),
    [
      ['johann', 'Johann'],
      ['father', 'Father'],
    ],
  );
  assert.match(saved.grants[0].licenseKey, /^KD1\./u);
  if (process.platform !== 'win32') assert.equal((await stat(output)).mode & 0o777, 0o600);
});

test('a repeated run with the same licences is accepted, a different file is never overwritten', async (t) => {
  const { repo, vault } = await sandbox(t);
  const output = join(vault, 'developer-licences.json');
  await issueDeveloperLicences({ tokenText: TOKEN, output }, service().fetcher, repo);
  await issueDeveloperLicences({ tokenText: TOKEN, output }, service().fetcher, repo);
  await writeFile(output, '{"tampered":true}\n');
  await assert.rejects(
    issueDeveloperLicences({ tokenText: TOKEN, output }, service().fetcher, repo),
    /already exists with different licences/u,
  );
  assert.equal(await readFile(output, 'utf8'), '{"tampered":true}\n');
});

test('refuses to write keys inside the repository or to an unusable destination', async (t) => {
  const { repo, vault } = await sandbox(t);
  await assert.rejects(
    issueDeveloperLicences(
      { tokenText: TOKEN, output: join(repo, 'keys.json') },
      service().fetcher,
      repo,
    ),
    /outside the repository/u,
  );
  await assert.rejects(
    issueDeveloperLicences(
      { tokenText: TOKEN, output: join(vault, 'missing', 'keys.json') },
      service().fetcher,
      repo,
    ),
    /must already exist/u,
  );
});

test('service refusals, malformed grants and bad inputs fail without leaking secrets', async (t) => {
  const { repo, vault } = await sandbox(t);
  const output = join(vault, 'keys.json');
  const cases = [
    [
      { father: () => Response.json({ error: { code: 'idempotency_conflict' } }, { status: 409 }) },
      /refused the Father grant \(idempotency_conflict\)/u,
    ],
    [
      {
        johann: () =>
          Response.json({ licenseId: 'x', licenseKey: 'KD1.y.short', displayName: 'Johann' }),
      },
      /invalid grant/u,
    ],
    [
      {
        johann: () => {
          throw new Error(`network failure carrying ${TOKEN}`);
        },
      },
      /could not be reached/u,
    ],
  ];
  for (const [overrides, expected] of cases) {
    const error = await issueDeveloperLicences(
      { tokenText: TOKEN, output },
      service(overrides).fetcher,
      repo,
    ).catch((caught) => caught);
    assert.ok(error instanceof IssuanceError);
    assert.match(error.message, expected);
    assert.equal(error.message.includes(TOKEN), false);
  }
  await assert.rejects(
    issueDeveloperLicences({ tokenText: 'short', output }, service().fetcher, repo),
    /admin token file is not valid/u,
  );
  await assert.rejects(
    issueDeveloperLicences(
      { service: 'http://license.kerfdesk.com', tokenText: TOKEN, output },
      service().fetcher,
      repo,
    ),
    /HTTPS origin/u,
  );
  await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('the command line reads the token from a file and rejects unknown flags', async (t) => {
  const { repo, vault } = await sandbox(t);
  const tokenFile = join(vault, 'admin-token');
  await writeFile(tokenFile, TOKEN);
  const output = join(vault, 'keys.json');
  const result = await runIssuance(
    ['--admin-token-file', tokenFile, '--output', output],
    service().fetcher,
    repo,
  );
  assert.equal(JSON.parse(await readFile(result.path, 'utf8')).grants.length, 2);
  await assert.rejects(
    runIssuance(['--token', TOKEN, '--output', output], service().fetcher, repo),
    /Usage/u,
  );
});
