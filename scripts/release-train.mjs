// The weekly commercial release train (ADR-541), run by
// .github/workflows/release-train.yml. Nothing here tags, builds, signs a
// build or uploads to GitHub.
//
//   decide     Is a beta due, from which main commit, as which version? No
//              secrets: reads the public beta catalogue and main's history.
//   preflight  Every secret and variable the Windows job needs is set, the
//              bucket answers, the signing key is the pinned one and the
//              approved terms match their hash. Runs before any paid runner.
//   terms      Fetches the owner-approved installer terms by their SHA-256.
//   promote    Copies the newest beta into the stable ring once it has had
//              QUIET_DAYS quiet days and nothing holds it.
//   status     No secrets: reports both rings and the promotion decision.
//
// usage: node scripts/release-train.mjs <command> [--name=value ...]
//   decide    --green=<file>... [--github-output=<file>] [--summary=<file>] [--now=<ISO>]
//   preflight --output=<terms file>
//   terms     --sha256=<hex> --output=<file>
//   promote   [--hold-variable=on] [--open-holds=<n>] [--summary=<file>] [--now=<ISO>]
//   status    [--hold-variable=on] [--open-holds=<n>] [--summary=<file>] [--now=<ISO>]

import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFirstParentLog, renderNotes } from './desktop-release-notes.mjs';
import {
  CATALOG_LIMIT,
  COMMERCIAL_BETA_CATALOG_KEY,
  COMMERCIAL_CATALOG_KEY,
  CommercialReleaseError,
  readCommercialCatalog,
} from './commercial-release-manifest.mjs';
import {
  catalogState,
  everyRelease,
  promoteCommercialRelease,
} from './commercial-release-rings.mjs';
import { publicKeyRecord } from './prepare-commercial-desktop.mjs';
import { createStableReleaseStore } from './stable-release-store.mjs';
import {
  QUIET_DAYS,
  cutDecision,
  holdReason,
  nextTrainVersion,
  promotionDecision,
} from './release-train-policy.mjs';

export const DOWNLOAD_ORIGIN = 'https://dl.kerfdesk.com';
const TERMS_LIMIT = 262_144;
const NOTES_LIMIT = 50_000;
// What the Windows job needs besides the switch. Names only, never values.
export const TRAIN_SECRETS = [
  'COMMERCIAL_ESIGNER_USERNAME',
  'COMMERCIAL_ESIGNER_PASSWORD',
  'COMMERCIAL_ESIGNER_TOTP_SECRET',
  'DESKTOP_STABLE_MANIFEST_PRIVATE_KEY',
  'COMMERCIAL_R2_API_TOKEN',
  'COMMERCIAL_CLOUDFLARE_ACCOUNT_ID',
];
export const TRAIN_VARIABLES = [
  'DESKTOP_STABLE_MANIFEST_KEY_ID',
  'DESKTOP_WINDOWS_PUBLISHER_NAME',
  'KERFDESK_COMMERCIAL_TERMS_SHA256',
];

export function readReleaseKeys(
  path = fileURLToPath(new URL('../public/desktop-release-keys.json', import.meta.url)),
) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function commercialStoreInput(env) {
  const accountId = env.COMMERCIAL_CLOUDFLARE_ACCOUNT_ID ?? '';
  if (!/^[a-f0-9]{32}$/u.test(accountId))
    throw new CommercialReleaseError(
      'COMMERCIAL_CLOUDFLARE_ACCOUNT_ID must be the 32-character Cloudflare account ID.',
    );
  if (typeof env.COMMERCIAL_R2_API_TOKEN !== 'string' || env.COMMERCIAL_R2_API_TOKEN.trim() === '')
    throw new CommercialReleaseError('COMMERCIAL_R2_API_TOKEN is required.');
  return { accountId, apiToken: env.COMMERCIAL_R2_API_TOKEN };
}

async function fromHost(url, method, accept, fetchImpl) {
  try {
    return await fetchImpl(url, {
      method,
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: accept },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`${url} could not be reached: ${error.message}`);
  }
}

async function boundedBody(response, limit) {
  if (response.body === null) throw new Error('Empty download host response.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error('Download host response is too large.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}

/** A catalogue's bytes as customers read them from dl.kerfdesk.com; null when there is none yet. */
export async function readPublicCatalogueBytes(key, fetchImpl = fetch) {
  const url = `${DOWNLOAD_ORIGIN}/${key}`;
  const response = await fromHost(url, 'GET', 'application/json', fetchImpl);
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`${url} answered HTTP ${response.status}.`);
  }
  return boundedBody(response, CATALOG_LIMIT);
}

/** A catalogue as customers read it from dl.kerfdesk.com; no catalogue yet is empty. */
export async function readPublicCatalogue(key, keySet, fetchImpl = fetch) {
  return readCommercialCatalog(await readPublicCatalogueBytes(key, fetchImpl), keySet);
}

/** An interrupted publication leaves its reservation; that version is never reused. */
export async function publicationReserved(version, fetchImpl = fetch) {
  const url = `${DOWNLOAD_ORIGIN}/desktop/commercial/releases/${version}/publication-reservation.json`;
  const response = await fromHost(url, 'HEAD', 'application/json', fetchImpl);
  await response.body?.cancel();
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw new Error(`${url} answered HTTP ${response.status}.`);
}

export async function freeTrainVersion(now, taken, reserved) {
  const skipped = [...taken];
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const version = nextTrainVersion(now, skipped);
    if (!(await reserved(version))) return version;
    skipped.push(version);
  }
  throw new Error(
    'Sixteen train versions in a row are reserved; check the interrupted publications.',
  );
}

export function gitCommand(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

/**
 * The cut: a due beta names its main commit, version and signed release time,
 * and the beta catalogue it was decided from, which the publisher must still
 * find when it lists the build (ADR-541).
 */
export async function decideCut({ greenSets, now, keySet, fetchImpl = fetch, git = gitCommand }) {
  const beta = await readPublicCatalogueBytes(COMMERCIAL_BETA_CATALOG_KEY, fetchImpl);
  const betaCatalogSha256 = catalogState(beta);
  // Beta lists every stable release too, except any published before the rings.
  const releases = everyRelease(
    readCommercialCatalog(beta, keySet),
    await readPublicCatalogue(COMMERCIAL_CATALOG_KEY, keySet, fetchImpl),
  );
  const newest = releases[0]?.payload ?? null;
  const baseline = newest?.sourceSha ?? null;
  if (baseline !== null) {
    try {
      git('merge-base', '--is-ancestor', baseline, 'HEAD');
    } catch {
      throw new Error(`The newest release's source ${baseline} is not in main's history.`);
    }
  }
  const range = baseline === null ? 'HEAD' : `${baseline}..HEAD`;
  const entries = parseFirstParentLog(
    git('log', '--first-parent', '--format=%H%x1f%s%x1f%b%x1e', range),
  );
  const decision = cutDecision({ entries, greenSets, baseline });
  if (!decision.due)
    return { ...decision, newest, version: null, publishedAt: null, betaCatalogSha256 };
  const version = await freeTrainVersion(
    now,
    releases.map((entry) => entry.payload.version),
    (candidate) => publicationReserved(candidate, fetchImpl),
  );
  return { ...decision, newest, version, publishedAt: now.toISOString(), betaCatalogSha256 };
}

export async function fetchApprovedTerms({ sha256, output, fetchImpl = fetch }) {
  if (!/^[a-f0-9]{64}$/u.test(sha256 ?? ''))
    throw new Error('KERFDESK_COMMERCIAL_TERMS_SHA256 must be a lowercase SHA-256.');
  const url = `${DOWNLOAD_ORIGIN}/desktop/commercial/terms/${sha256}.txt`;
  const response = await fromHost(url, 'GET', 'text/plain', fetchImpl);
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`The approved terms are not at ${url} (HTTP ${response.status}).`);
  }
  const bytes = await boundedBody(response, TERMS_LIMIT);
  if (createHash('sha256').update(bytes).digest('hex') !== sha256)
    throw new Error(`The terms at ${url} do not match KERFDESK_COMMERCIAL_TERMS_SHA256.`);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.trim() === '' || text.includes('\0'))
    throw new Error('The approved terms must be nonempty text.');
  writeFileSync(output, bytes, { mode: 0o600 });
  return { url, bytes: bytes.length };
}

/** The private key must be the one the pinned key ID names; never echoes either. */
export function requirePinnedSigningKey(env, keySet) {
  const keys = publicKeyRecord(keySet, 'stable');
  const keyId = env.DESKTOP_STABLE_MANIFEST_KEY_ID;
  if (!Object.hasOwn(keys, keyId))
    throw new Error('DESKTOP_STABLE_MANIFEST_KEY_ID does not name a pinned stable release key.');
  let spki;
  try {
    const key = createPrivateKey(env.DESKTOP_STABLE_MANIFEST_PRIVATE_KEY);
    spki = createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64');
  } catch {
    spki = null;
  }
  if (spki !== keys[keyId])
    throw new Error(
      'DESKTOP_STABLE_MANIFEST_PRIVATE_KEY is not the key DESKTOP_STABLE_MANIFEST_KEY_ID pins.',
    );
}

export async function preflight({
  env,
  keySet,
  termsOutput,
  fetchImpl = fetch,
  createStore = createStableReleaseStore,
}) {
  const missing = [...TRAIN_SECRETS, ...TRAIN_VARIABLES].filter(
    (name) => typeof env[name] !== 'string' || env[name].trim() === '',
  );
  if (missing.length > 0)
    throw new Error(`The release train needs these secrets and variables: ${missing.join(', ')}.`);
  requirePinnedSigningKey(env, keySet);
  // Creating the store proves the token reaches the kerfdesk-downloads bucket.
  await createStore({ ...commercialStoreInput(env), fetchRequest: fetchImpl });
  await fetchApprovedTerms({
    sha256: env.KERFDESK_COMMERCIAL_TERMS_SHA256,
    output: termsOutput,
    fetchImpl,
  });
}

function ringsOf(betaBytes, stableBytes, keySet) {
  return {
    beta: readCommercialCatalog(betaBytes, keySet),
    stable: readCommercialCatalog(stableBytes, keySet),
    catalogs: { beta: catalogState(betaBytes), stable: catalogState(stableBytes) },
  };
}

export async function runPromotion({ store, keySet, now, held }) {
  const rings = ringsOf(
    await store.get(COMMERCIAL_BETA_CATALOG_KEY),
    await store.get(COMMERCIAL_CATALOG_KEY),
    keySet,
  );
  const decision = promotionDecision({ ...rings, now, held });
  // The train states the stable catalogue it decided from.
  const result = decision.due
    ? await promoteCommercialRelease({
        store,
        keySet,
        version: decision.version,
        expectedCatalogSha256: rings.catalogs.stable,
      })
    : null;
  return { ...rings, decision, result };
}

export async function ringStatus({ keySet, now, held, fetchImpl = fetch }) {
  const rings = ringsOf(
    await readPublicCatalogueBytes(COMMERCIAL_BETA_CATALOG_KEY, fetchImpl),
    await readPublicCatalogueBytes(COMMERCIAL_CATALOG_KEY, fetchImpl),
    keySet,
  );
  return { ...rings, decision: promotionDecision({ ...rings, now, held }), result: null };
}

const describe = (entry) =>
  entry === undefined
    ? 'none yet'
    : `${entry.payload.version}, released ${entry.payload.publishedAt}, from ${entry.payload.sourceSha.slice(0, 9)}`;

// The catalogue SHA-256s are what an operator states to publish or promote by hand.
export function ringsSummary(title, { beta, stable, catalogs, decision, result }) {
  const outcome =
    result === null
      ? `Nothing promoted: ${decision.reason}`
      : `${result.version}: ${result.status} to the stable ring.`;
  return [
    `## ${title}`,
    '',
    outcome,
    '',
    `- Newest beta: ${describe(beta[0])}`,
    `- Newest stable: ${describe(stable[0])}`,
    `- Promotion: ${decision.due ? 'due' : 'not due'}. ${decision.reason}`,
    `- Quiet days before promotion: ${QUIET_DAYS}`,
    `- Beta catalogue SHA-256: ${catalogs.beta}`,
    `- Stable catalogue SHA-256: ${result?.catalogSha256 ?? catalogs.stable}`,
  ].join('\n');
}

/** The decide step's outputs, which the workflow's later jobs read. */
export function cutOutputs(cut) {
  return [
    `due=${cut.due}`,
    `sha=${cut.due ? cut.commit : ''}`,
    `version=${cut.version ?? ''}`,
    `published_at=${cut.publishedAt ?? ''}`,
    `beta_catalog_sha256=${cut.betaCatalogSha256}`,
    '',
  ].join('\n');
}

export function cutSummary(cut) {
  const lines = [
    '## Release train: weekly cut',
    '',
    `${cut.due ? 'Due' : 'Not due'}: ${cut.reason}`,
  ];
  lines.push('', `- Newest release: ${cut.newest === null ? 'none yet' : cut.newest.version}`);
  lines.push(`- Beta catalogue SHA-256: ${cut.betaCatalogSha256}`);
  if (!cut.due) return lines.join('\n');
  lines.push(`- Builds ${cut.version} from ${cut.commit}, released ${cut.publishedAt}`);
  let notes = renderNotes(cut.shipped);
  if (notes.length > NOTES_LIMIT)
    notes = `${notes.slice(0, notes.lastIndexOf('\n', NOTES_LIMIT))}\n\n_More changes are not listed here._`;
  lines.push('', '<details><summary>What changed</summary>', '', notes, '', '</details>');
  return lines.join('\n');
}

function openHolds(value) {
  const count = Number(value ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('--open-holds must be a count.');
  return count;
}

function report(options, text) {
  const [summary] = options('summary');
  if (summary === undefined) process.stdout.write(`${text}\n`);
  else appendFileSync(summary, `${text}\n`);
}

const COMMANDS = {
  async decide({ options, now, keySet }) {
    const greenSets = options('green').map(
      (file) => new Set(readFileSync(file, 'utf8').split(/\s+/u).filter(Boolean)),
    );
    if (greenSets.length === 0) throw new Error('decide needs --green=<file> for each workflow.');
    const cut = await decideCut({ greenSets, now, keySet });
    const [githubOutput] = options('github-output');
    if (githubOutput !== undefined) appendFileSync(githubOutput, cutOutputs(cut));
    report(options, cutSummary(cut));
  },
  async preflight({ options, keySet }) {
    const [termsOutput] = options('output');
    if (termsOutput === undefined) throw new Error('preflight needs --output=<terms file>.');
    await preflight({ env: process.env, keySet, termsOutput });
    process.stdout.write('Every release train secret and variable is ready.\n');
  },
  async terms({ options }) {
    const [sha256] = options('sha256');
    const [output] = options('output');
    if (output === undefined) throw new Error('terms needs --output=<file>.');
    const { url, bytes } = await fetchApprovedTerms({ sha256, output });
    process.stdout.write(`Approved terms: ${bytes} bytes from ${url}\n`);
  },
  async promote({ options, now, keySet, held }) {
    const store = await createStableReleaseStore(commercialStoreInput(process.env));
    report(
      options,
      ringsSummary('Release train: promotion', await runPromotion({ store, keySet, now, held })),
    );
  },
  async status({ options, now, keySet, held }) {
    report(options, ringsSummary('Release train: rings', await ringStatus({ keySet, now, held })));
  },
};

export async function runCli(argv) {
  const [command, ...rest] = argv;
  const options = (name) =>
    rest.filter((arg) => arg.startsWith(`--${name}=`)).map((arg) => arg.slice(name.length + 3));
  if (!Object.hasOwn(COMMANDS, command ?? ''))
    throw new Error(
      'usage: release-train.mjs decide|preflight|terms|promote|status [--name=value]',
    );
  const [nowArg] = options('now');
  const now = nowArg === undefined ? new Date() : new Date(nowArg);
  if (!Number.isFinite(now.getTime())) throw new Error('--now must be a valid date.');
  const [variable] = options('hold-variable');
  const held = holdReason({ variable, openIssues: openHolds(options('open-holds')[0]) });
  await COMMANDS[command]({ options, now, keySet: readReleaseKeys(), held });
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    // Messages name inputs, never their values.
    process.stderr.write(`release train: ${error.message}\n`);
    process.exitCode = 1;
  });
}
