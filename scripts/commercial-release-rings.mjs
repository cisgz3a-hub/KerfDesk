// The two commercial update rings on dl.kerfdesk.com (ADR-541). A release is
// published into the beta catalogue; promotion later copies its identical
// signed envelope into the stable catalogue that shipped clients read. Nothing
// is signed again: stable lists the same bytes beta listed.
import { isDeepStrictEqual } from 'node:util';
import { compareStableVersions, stableVersionParts } from './stable-release-artifacts.mjs';
import {
  COMMERCIAL_BETA_CATALOG_KEY,
  COMMERCIAL_CATALOG_KEY,
  COMMERCIAL_PREFIX,
  CommercialReleaseError,
  catalogBytes,
  digest,
  readCommercialCatalog,
} from './commercial-release-manifest.mjs';

export const sameBytes = (a, b) => (a === null ? b === null : b !== null && a.equals(b));
/** How an operator names a catalogue: its SHA-256, or `none` when it does not exist. */
export const catalogState = (bytes) => (bytes === null ? 'none' : digest(bytes));
export const EXPECTED_CATALOG = /^(?:none|[a-f0-9]{64})$/u;

/**
 * Each run that replaces a catalogue is told which catalogue to expect: the
 * SHA-256 the previous run printed, which the operator reviewed, or `none`
 * before the first release. A deleted, truncated or replaced live catalogue is
 * refused before any write instead of being accepted and then made permanent.
 * The one exception resumes an identical run that already listed this release:
 * the live catalogue is then exactly the expected one plus this release's entry.
 */
export function requireExpectedCatalog(initial, keySet, payload, expected, ring) {
  const live = catalogState(initial);
  if (live === expected) return;
  let entries = [];
  try {
    entries = readCommercialCatalog(initial, keySet);
  } catch {
    // An unreadable catalogue that the operator did not state is a mismatch.
  }
  const others = entries.filter((item) => !isDeepStrictEqual(item.payload, payload));
  const before =
    others.length === 0 && expected === 'none' ? 'none' : catalogState(catalogBytes(others));
  if (others.length === entries.length || before !== expected)
    throw new CommercialReleaseError(
      `Live ${ring} catalogue (${live === 'none' ? 'missing' : `SHA-256 ${live}`}) is not the expected catalogue; review it before publishing.`,
    );
}

/**
 * Every release either ring lists, newest first. The beta ring holds every
 * stable release too, so one version can only ever mean one signed envelope.
 */
export function everyRelease(beta, stable) {
  const byVersion = new Map(beta.map((entry) => [entry.payload.version, entry]));
  for (const entry of stable) {
    const listed = byVersion.get(entry.payload.version);
    if (listed !== undefined && !isDeepStrictEqual(listed.envelope, entry.envelope))
      throw new CommercialReleaseError(
        `Beta and stable catalogues disagree about ${entry.payload.version}.`,
      );
    if (listed === undefined) byVersion.set(entry.payload.version, entry);
  }
  return [...byVersion.values()].sort((a, b) =>
    compareStableVersions(b.payload.version, a.payload.version),
  );
}

/** The newest listed release must not be newer, or released later, than this one. */
export function requireForwardRelease(listed, payload, ring) {
  if (listed === undefined) return;
  if (compareStableVersions(listed.version, payload.version) > 0)
    throw new CommercialReleaseError(`Refusing commercial ${ring} rollback.`);
  if (Date.parse(payload.publishedAt) < Date.parse(listed.publishedAt))
    throw new CommercialReleaseError(
      `Commercial ${ring} release date cannot precede the current release.`,
    );
}

/**
 * The stable ring points customers at the release objects, so promotion first
 * proves they are still the exact published bytes: the update manifest is the
 * beta entry byte for byte, and every artifact matches its signed digests.
 */
export async function verifyPublishedRelease(store, { envelope, payload }) {
  const prefix = `${COMMERCIAL_PREFIX}/releases/${payload.version}`;
  const manifest = await store.get(`${prefix}/update-manifest.json`);
  if (!sameBytes(manifest, Buffer.from(`${JSON.stringify(envelope)}\n`)))
    throw new CommercialReleaseError(
      `Published update manifest for ${payload.version} differs from its beta entry.`,
    );
  for (const artifact of payload.artifacts) {
    const bytes = await store.get(`${prefix}/${artifact.name}`);
    if (
      bytes === null ||
      bytes.length !== artifact.bytes ||
      digest(bytes) !== artifact.sha256 ||
      digest(bytes, 'sha512') !== artifact.sha512
    )
      throw new CommercialReleaseError(
        `Published ${artifact.name} does not match its signed manifest.`,
      );
  }
}

/**
 * Copies one beta release into the stable catalogue. Refuses a stable
 * catalogue other than the expected one, a version beta does not list, a
 * different envelope already in stable, a rollback or backdated release,
 * changed release objects, and a stable catalogue that moved while this ran.
 * The final comparison detects concurrent changes but is not a distributed
 * lock; the workflow serializes publishers.
 */
export async function promoteCommercialRelease({ store, keySet, version, expectedCatalogSha256 }) {
  if (typeof expectedCatalogSha256 !== 'string' || !EXPECTED_CATALOG.test(expectedCatalogSha256))
    throw new CommercialReleaseError(
      'The expected stable catalogue SHA-256, or none, is mandatory.',
    );
  stableVersionParts(version);
  const initial = await store.get(COMMERCIAL_CATALOG_KEY);
  const beta = readCommercialCatalog(await store.get(COMMERCIAL_BETA_CATALOG_KEY), keySet);
  const entry = beta.find((item) => item.payload.version === version);
  if (entry === undefined)
    throw new CommercialReleaseError(`Commercial ${version} is not in the beta catalogue.`);
  requireExpectedCatalog(initial, keySet, entry.payload, expectedCatalogSha256, 'stable');
  const stable = readCommercialCatalog(initial, keySet);
  const listed = stable.find((item) => item.payload.version === version);
  if (listed !== undefined) {
    if (!isDeepStrictEqual(listed.envelope, entry.envelope))
      throw new CommercialReleaseError(`The stable catalogue lists a different ${version}.`);
    return { status: 'already-promoted', version, catalogSha256: catalogState(initial) };
  }
  requireForwardRelease(stable[0]?.payload, entry.payload, 'stable');
  const next = catalogBytes([entry, ...stable]);
  // Validate the whole new catalogue before any storage write.
  readCommercialCatalog(next, keySet);
  await verifyPublishedRelease(store, entry);
  if (!sameBytes(initial, await store.get(COMMERCIAL_CATALOG_KEY)))
    throw new CommercialReleaseError('Stable commercial catalogue changed during promotion.');
  await store.put(COMMERCIAL_CATALOG_KEY, next, {
    contentType: 'application/json',
    cacheControl: 'no-store',
  });
  if (!sameBytes(next, await store.get(COMMERCIAL_CATALOG_KEY)))
    throw new CommercialReleaseError('Stable commercial catalogue readback failed.');
  // The stable catalogue's SHA-256 is what the next promotion states.
  return { status: 'promoted', version, catalogSha256: catalogState(next) };
}
