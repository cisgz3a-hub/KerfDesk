import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  COMMERCIAL_BETA_CATALOG_KEY,
  COMMERCIAL_CATALOG_KEY,
  CommercialReleaseError,
  digest,
} from './commercial-release-manifest.mjs';
import { publishCommercialRelease } from './commercial-release-publisher.mjs';
import { catalogState } from './commercial-release-rings.mjs';
import { promoteFromCli, promotionFailureMessage } from './promote-commercial-release.mjs';
import {
  TRAIN_SECRETS,
  TRAIN_VARIABLES,
  cutOutputs,
  cutSummary,
  decideCut,
  fetchApprovedTerms,
  preflight,
  publicationReserved,
  readPublicCatalogue,
  ringStatus,
  ringsSummary,
  runCli,
  runPromotion,
} from './release-train.mjs';
import {
  fixture,
  keyId,
  keySet,
  memoryStore,
  privateKeyPem,
} from './commercial-release-test-support.mjs';

const ORIGIN = 'https://dl.kerfdesk.com';
const NOW = new Date('2026-09-29T07:17:00.000Z');
const RESERVATION = 'desktop/commercial/releases/2026.40.0/publication-reservation.json';

async function publishedStore(...releases) {
  const f = memoryStore();
  for (const release of releases)
    await publishCommercialRelease({
      release,
      store: f.store,
      keySet,
      privateKeyPem,
      keyId,
      verifyInstaller: async () => undefined,
      expectedCatalogSha256: catalogState(f.objects.get(COMMERCIAL_BETA_CATALOG_KEY) ?? null),
    });
  return f;
}
// The download host: listed objects answer 200, everything else 404.
function host(objects) {
  const requests = [];
  return {
    requests,
    fetchImpl: async (url, init) => {
      requests.push({ url, method: init.method, redirect: init.redirect });
      const key = url.slice(ORIGIN.length + 1);
      if (!Object.hasOwn(objects, key)) return new Response(null, { status: 404 });
      const value = objects[key];
      if (typeof value === 'number') return new Response(null, { status: value });
      return new Response(init.method === 'HEAD' ? null : value, { status: 200 });
    },
  };
}
const logOf = (...commits) =>
  commits.map(([sha, subject]) => `${sha.repeat(40)}\x1f${subject}\x1f\x1e`).join('\n');
function fakeGit(text, { ancestor = true } = {}) {
  const calls = [];
  const git = (...args) => {
    calls.push(args);
    if (args[0] === 'merge-base' && !ancestor) throw new Error('not an ancestor');
    return args[0] === 'log' ? text : '';
  };
  return { calls, git };
}
const LOG = logOf(
  ['c', 'feat(cnc): add a chamfer tool (#12)'],
  ['b', 'fix: keep the laser off (#11)'],
);

test('the first cut builds the newest fully checked commit as the first version of the week', async () => {
  const { git, calls } = fakeGit(LOG);
  const server = host({});
  const cut = await decideCut({
    greenSets: [new Set(['c'.repeat(40), 'b'.repeat(40)])],
    now: NOW,
    keySet,
    fetchImpl: server.fetchImpl,
    git,
  });
  assert.deepEqual(
    [cut.due, cut.commit, cut.version, cut.publishedAt, cut.newest],
    [true, 'c'.repeat(40), '2026.40.0', '2026-09-29T07:17:00.000Z', null],
  );
  assert.deepEqual(calls, [['log', '--first-parent', '--format=%H%x1f%s%x1f%b%x1e', 'HEAD']]);
  assert.deepEqual(
    server.requests.map((request) => [request.method, request.url.slice(ORIGIN.length + 1)]),
    [
      ['GET', COMMERCIAL_BETA_CATALOG_KEY],
      ['GET', COMMERCIAL_CATALOG_KEY],
      ['HEAD', RESERVATION],
    ],
  );
  assert.ok(server.requests.every((request) => request.redirect === 'error'));
  const summary = cutSummary(cut);
  assert.match(
    summary,
    /^## Release train: weekly cut\n\nDue: 2 user-facing changes, up to c{9}\./u,
  );
  assert.match(summary, /Builds 2026\.40\.0 from c{40}, released 2026-09-29T07:17:00\.000Z/u);
  assert.match(summary, /Add a chamfer tool/u);
  // The publisher must still find the beta catalogue the cut was decided from.
  assert.match(summary, /- Beta catalogue SHA-256: none\n/u);
  assert.equal(
    cutOutputs(cut),
    `due=true\nsha=${'c'.repeat(40)}\nversion=2026.40.0\npublished_at=2026-09-29T07:17:00.000Z\nbeta_catalog_sha256=none\n`,
  );
});

test('later cuts count from the newest release and never reuse a reserved version', async () => {
  const f = await publishedStore(fixture('1.2.3'));
  const { git, calls } = fakeGit(LOG);
  const server = host({
    [COMMERCIAL_BETA_CATALOG_KEY]: f.objects.get(COMMERCIAL_BETA_CATALOG_KEY),
    [RESERVATION]: '{}',
  });
  const cut = await decideCut({
    greenSets: [new Set(['c'.repeat(40)])],
    now: NOW,
    keySet,
    fetchImpl: server.fetchImpl,
    git,
  });
  assert.equal(cut.version, '2026.40.1');
  assert.equal(cut.newest.version, '1.2.3');
  assert.equal(cut.betaCatalogSha256, digest(f.objects.get(COMMERCIAL_BETA_CATALOG_KEY)));
  assert.deepEqual(calls[0], ['merge-base', '--is-ancestor', 'a'.repeat(40), 'HEAD']);
  assert.equal(calls[1].at(-1), `${'a'.repeat(40)}..HEAD`);
  const notDue = await decideCut({
    greenSets: [new Set()],
    now: NOW,
    keySet,
    fetchImpl: server.fetchImpl,
    git,
  });
  assert.deepEqual([notDue.due, notDue.version, notDue.publishedAt], [false, null, null]);
  assert.match(cutSummary(notDue), /Not due: No main commit since the newest release/u);
  assert.match(
    cutOutputs(notDue),
    /^due=false\nsha=\nversion=\npublished_at=\nbeta_catalog_sha256=[a-f0-9]{64}\n$/u,
  );
  await assert.rejects(
    decideCut({
      greenSets: [new Set()],
      now: NOW,
      keySet,
      fetchImpl: server.fetchImpl,
      git: fakeGit(LOG, { ancestor: false }).git,
    }),
    /is not in main's history/u,
  );
});

test('the download host must answer plainly: errors, oversize or unsigned catalogues stop the train', async () => {
  const read = (value) =>
    readPublicCatalogue(
      COMMERCIAL_CATALOG_KEY,
      keySet,
      host({ [COMMERCIAL_CATALOG_KEY]: value }).fetchImpl,
    );
  assert.deepEqual(
    await readPublicCatalogue(COMMERCIAL_CATALOG_KEY, keySet, host({}).fetchImpl),
    [],
  );
  await assert.rejects(read(503), /HTTP 503/u);
  await assert.rejects(read(Buffer.alloc(256 * 1024 + 1)), /too large/u);
  await assert.rejects(read('{"schemaVersion":1,"releases":[{}]}'), /Invalid commercial release/u);
  const offline = async () => {
    throw new Error('getaddrinfo ENOTFOUND dl.kerfdesk.com');
  };
  await assert.rejects(
    readPublicCatalogue(COMMERCIAL_CATALOG_KEY, keySet, offline),
    /catalog\.json could not be reached: getaddrinfo ENOTFOUND/u,
  );
  await assert.rejects(publicationReserved('2026.40.0', offline), /could not be reached/u);
  await assert.rejects(
    publicationReserved('2026.40.0', host({ [RESERVATION]: 403 }).fetchImpl),
    /HTTP 403/u,
  );
});

test('the approved installer terms are fetched by their hash and nothing else', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'release-train-terms-'));
  try {
    const terms = 'KerfDesk Pro licence agreement\n';
    const sha256 = createHash('sha256').update(terms).digest('hex');
    const output = join(directory, 'terms.txt');
    const key = `desktop/commercial/terms/${sha256}.txt`;
    const fetched = await fetchApprovedTerms({
      sha256,
      output,
      fetchImpl: host({ [key]: terms }).fetchImpl,
    });
    assert.equal(fetched.bytes, terms.length);
    assert.equal(readFileSync(output, 'utf8'), terms);
    const other = createHash('sha256').update('other').digest('hex');
    await assert.rejects(
      fetchApprovedTerms({
        sha256: other,
        output,
        fetchImpl: host({ [`desktop/commercial/terms/${other}.txt`]: terms }).fetchImpl,
      }),
      /do not match/u,
    );
    await assert.rejects(
      fetchApprovedTerms({ sha256: other, output, fetchImpl: host({}).fetchImpl }),
      /HTTP 404/u,
    );
    await assert.rejects(fetchApprovedTerms({ sha256: 'ABC', output }), /lowercase SHA-256/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('preflight names every missing secret or variable, and checks the key, bucket and terms', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'release-train-preflight-'));
  try {
    const terms = 'Terms\n';
    const sha256 = createHash('sha256').update(terms).digest('hex');
    const env = {
      COMMERCIAL_ESIGNER_USERNAME: 'signer',
      COMMERCIAL_ESIGNER_PASSWORD: 'password',
      COMMERCIAL_ESIGNER_TOTP_SECRET: 'totp',
      DESKTOP_STABLE_MANIFEST_PRIVATE_KEY: privateKeyPem,
      COMMERCIAL_R2_API_TOKEN: 'token',
      COMMERCIAL_CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
      DESKTOP_STABLE_MANIFEST_KEY_ID: keyId,
      DESKTOP_WINDOWS_PUBLISHER_NAME: 'Example Publisher',
      KERFDESK_COMMERCIAL_TERMS_SHA256: sha256,
    };
    assert.deepEqual(Object.keys(env).sort(), [...TRAIN_SECRETS, ...TRAIN_VARIABLES].sort());
    const stores = [];
    const run = (overrides) =>
      preflight({
        env: { ...env, ...overrides },
        keySet,
        termsOutput: join(directory, 'terms.txt'),
        fetchImpl: host({ [`desktop/commercial/terms/${sha256}.txt`]: terms }).fetchImpl,
        createStore: async (input) => stores.push(input),
      });
    await run({});
    assert.deepEqual(
      stores.map(({ accountId, apiToken }) => [accountId, apiToken]),
      [['a'.repeat(32), 'token']],
    );
    assert.equal(readFileSync(join(directory, 'terms.txt'), 'utf8'), terms);
    const missing = await run({
      COMMERCIAL_R2_API_TOKEN: ' ',
      DESKTOP_WINDOWS_PUBLISHER_NAME: undefined,
    }).catch((error) => error.message);
    assert.equal(
      missing,
      'The release train needs these secrets and variables: COMMERCIAL_R2_API_TOKEN, DESKTOP_WINDOWS_PUBLISHER_NAME.',
    );
    const other = generateKeyPairSync('ed25519').privateKey.export({
      format: 'pem',
      type: 'pkcs8',
    });
    const wrongKey = await run({ DESKTOP_STABLE_MANIFEST_PRIVATE_KEY: other }).catch(
      (error) => error.message,
    );
    assert.match(wrongKey, /is not the key DESKTOP_STABLE_MANIFEST_KEY_ID pins/u);
    assert.doesNotMatch(wrongKey, /PRIVATE KEY/u);
    await assert.rejects(
      run({ DESKTOP_STABLE_MANIFEST_KEY_ID: 'stable-unknown' }),
      /pinned stable release key/u,
    );
    await assert.rejects(run({ COMMERCIAL_CLOUDFLARE_ACCOUNT_ID: 'x' }), /32-character/u);
    assert.equal(stores.length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the daily promotion moves the newest beta once it has been quiet, and reports why not otherwise', async () => {
  const f = await publishedStore(fixture('1.2.3', { sourceRef: 'refs/heads/main' }));
  const early = await runPromotion({
    store: f.store,
    keySet,
    now: new Date('2026-01-04T00:00:00Z'),
    held: null,
  });
  assert.equal(early.result, null);
  assert.match(
    ringsSummary('Release train: promotion', early),
    /Nothing promoted: 1\.2\.3 reaches everyone after 4 quiet days/u,
  );
  const held = await runPromotion({
    store: f.store,
    keySet,
    now: NOW,
    held: 'the KERFDESK_RELEASE_HOLD variable is on',
  });
  assert.equal(held.result, null);
  assert.equal(f.objects.has(COMMERCIAL_CATALOG_KEY), false);
  const due = await runPromotion({ store: f.store, keySet, now: NOW, held: null });
  assert.deepEqual(due.result, {
    status: 'promoted',
    version: '1.2.3',
    catalogSha256: digest(f.objects.get(COMMERCIAL_CATALOG_KEY)),
  });
  assert.deepEqual(
    f.objects.get(COMMERCIAL_CATALOG_KEY),
    f.objects.get(COMMERCIAL_BETA_CATALOG_KEY),
  );
  const summary = ringsSummary('Release train: promotion', due);
  assert.match(summary, /^## Release train: promotion\n\n1\.2\.3: promoted to the stable ring\./u);
  assert.match(summary, /- Newest beta: 1\.2\.3, released 2026-01-01T00:00:00\.000Z, from a{9}/u);
  // The SHA-256s an operator states to publish or promote by hand next.
  const shas = digest(f.objects.get(COMMERCIAL_BETA_CATALOG_KEY));
  assert.match(summary, new RegExp(`- Beta catalogue SHA-256: ${shas}\n`, 'u'));
  assert.match(
    summary,
    new RegExp(`- Stable catalogue SHA-256: ${due.result.catalogSha256}$`, 'u'),
  );
  assert.match(
    ringsSummary('Release train: promotion', early),
    /- Stable catalogue SHA-256: none$/u,
  );
  // Status reads both rings from the public host, with no credentials at all.
  const status = await ringStatus({
    keySet,
    now: NOW,
    held: null,
    fetchImpl: host({
      [COMMERCIAL_BETA_CATALOG_KEY]: f.objects.get(COMMERCIAL_BETA_CATALOG_KEY),
      [COMMERCIAL_CATALOG_KEY]: f.objects.get(COMMERCIAL_CATALOG_KEY),
    }).fetchImpl,
  });
  assert.equal(status.decision.reason, '1.2.3 is already on the stable ring.');
  assert.deepEqual(status.catalogs, {
    beta: digest(f.objects.get(COMMERCIAL_BETA_CATALOG_KEY)),
    stable: digest(f.objects.get(COMMERCIAL_CATALOG_KEY)),
  });
});

test('the operator promotes one named version by hand, and the CLIs refuse bad input', async () => {
  const f = await publishedStore(fixture());
  const env = {
    COMMERCIAL_R2_API_TOKEN: 'token',
    COMMERCIAL_CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32),
  };
  const inputs = [];
  const createStore = async (input) => {
    inputs.push(input);
    return f.store;
  };
  const expected = ['--expected-catalog-sha256', 'none'];
  assert.deepEqual(await promoteFromCli([...expected, '1.2.3'], { env, createStore, keySet }), {
    status: 'promoted',
    version: '1.2.3',
    catalogSha256: digest(f.objects.get(COMMERCIAL_CATALOG_KEY)),
  });
  assert.deepEqual(inputs, [{ accountId: 'b'.repeat(32), apiToken: 'token' }]);
  for (const args of [
    [],
    ['1.2.3'],
    [...expected],
    [...expected, '1.2'],
    [...expected, '1.2.3', 'extra'],
    ['--expected-catalog-sha256', 'latest', '1.2.3'],
  ])
    await assert.rejects(promoteFromCli(args, { env, createStore, keySet }), /Usage/u);
  // Stable is now `none` plus 1.2.3, so the same promotion resumes as a no-op.
  assert.equal(
    (await promoteFromCli([...expected, '1.2.3'], { env, createStore, keySet })).status,
    'already-promoted',
  );
  await assert.rejects(
    promoteFromCli([...expected, '1.2.3'], { env: {}, createStore, keySet }),
    /COMMERCIAL_CLOUDFLARE_ACCOUNT_ID/u,
  );
  // Own refusals print; anything else, which may quote a URL, gets one generic line.
  assert.equal(
    promotionFailureMessage(
      new CommercialReleaseError('Commercial 1.2.4 is not in the beta catalogue.'),
      env,
    ),
    'Commercial promotion failed: Commercial 1.2.4 is not in the beta catalogue.',
  );
  for (const error of [
    new Error(`R2 request failed: https://api.cloudflare.com/client/v4/accounts/${'b'.repeat(32)}`),
    new CommercialReleaseError(`account ${'b'.repeat(32)}`),
  ])
    assert.match(promotionFailureMessage(error, env), /^Commercial promotion failed\. Check/u);
  await assert.rejects(runCli(['tag']), /usage: release-train\.mjs/u);
  await assert.rejects(runCli(['decide']), /--green=<file>/u);
  await assert.rejects(runCli(['status', '--now=yesterday']), /valid date/u);
  await assert.rejects(runCli(['promote', '--open-holds=-1']), /count/u);
});
