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
  catalogBytes,
  digest,
  readCommercialCatalog,
} from './commercial-release-manifest.mjs';

export const sameBytes = (a, b) => (a === null ? b === null : b !== null && a.equals(b));

/**
 * Every release either ring lists, newest first. The beta ring holds every
 * stable release too, so one version can only ever mean one signed envelope.
 */
export function everyRelease(beta, stable) {
  const byVersion = new Map(beta.map((entry) => [entry.payload.version, entry]));
  for (const entry of stable) {
    const listed = byVersion.get(entry.payload.version);
    if (listed !== undefined && !isDeepStrictEqual(listed.envelope, entry.envelope))
      throw new Error(`Beta and stable catalogues disagree about ${entry.payload.version}.`);
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
    throw new Error(`Refusing commercial ${ring} rollback.`);
  if (Date.parse(payload.publishedAt) < Date.parse(listed.publishedAt))
    throw new Error(`Commercial ${ring} release date cannot precede the current release.`);
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
    throw new Error(
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
      throw new Error(`Published ${artifact.name} does not match its signed manifest.`);
  }
}

/**
 * Copies one beta release into the stable catalogue. Refuses a version beta
 * does not list, a different envelope already in stable, a rollback or
 * backdated release, changed release objects, and a stable catalogue that
 * moved while this ran. The final comparison detects concurrent changes but is
 * not a distributed lock; the workflow serializes publishers.
 */
export async function promoteCommercialRelease({ store, keySet, version }) {
  stableVersionParts(version);
  const initial = await store.get(COMMERCIAL_CATALOG_KEY);
  const stable = readCommercialCatalog(initial, keySet);
  const beta = readCommercialCatalog(await store.get(COMMERCIAL_BETA_CATALOG_KEY), keySet);
  const entry = beta.find((item) => item.payload.version === version);
  if (entry === undefined) throw new Error(`Commercial ${version} is not in the beta catalogue.`);
  const listed = stable.find((item) => item.payload.version === version);
  if (listed !== undefined) {
    if (!isDeepStrictEqual(listed.envelope, entry.envelope))
      throw new Error(`The stable catalogue lists a different ${version}.`);
    return { status: 'already-promoted', version };
  }
  requireForwardRelease(stable[0]?.payload, entry.payload, 'stable');
  const next = catalogBytes([entry, ...stable]);
  // Validate the whole new catalogue before any storage write.
  readCommercialCatalog(next, keySet);
  await verifyPublishedRelease(store, entry);
  if (!sameBytes(initial, await store.get(COMMERCIAL_CATALOG_KEY)))
    throw new Error('Stable commercial catalogue changed during promotion.');
  await store.put(COMMERCIAL_CATALOG_KEY, next, {
    contentType: 'application/json',
    cacheControl: 'no-store',
  });
  if (!sameBytes(next, await store.get(COMMERCIAL_CATALOG_KEY)))
    throw new Error('Stable commercial catalogue readback failed.');
  return { status: 'promoted', version };
}
