// Promotes one commercial release from the beta ring to the stable ring
// (ADR-541): the operator's counterpart of the release train's daily
// promotion, for a release published by hand. It copies the release's signed
// beta entry, byte for byte, into the catalogue that shipped clients and the
// download page read. Nothing is built or signed again. Run one publisher at a
// time: the release train holds the kerfdesk-commercial-publication group.
//
// usage: node scripts/promote-commercial-release.mjs --expected-catalog-sha256 <64-hex|none> <version>
// env:   COMMERCIAL_R2_API_TOKEN, COMMERCIAL_CLOUDFLARE_ACCOUNT_ID
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommercialReleaseError, printableRefusal } from './commercial-release-manifest.mjs';
import { EXPECTED_CATALOG, promoteCommercialRelease } from './commercial-release-rings.mjs';
import { createStableReleaseStore } from './stable-release-store.mjs';
import { commercialStoreInput, readReleaseKeys } from './release-train.mjs';

const USAGE =
  'Usage: promote-commercial-release.mjs --expected-catalog-sha256 <64-hex|none> <version>';
const GENERIC_FAILURE =
  'Commercial promotion failed. Check the version, the expected stable catalogue and the protected R2 configuration.';

// The expected catalogue is the reviewed live stable catalogue, which promotion
// replaces: the SHA-256 the previous promotion printed, or `none` before the
// first release reaches stable.
export function parsePromotionArguments(args) {
  const flag = args.indexOf('--expected-catalog-sha256');
  const expectedCatalogSha256 = flag === -1 ? undefined : args[flag + 1]?.toLowerCase();
  const rest = flag === -1 ? args : args.filter((_, index) => index !== flag && index !== flag + 1);
  if (
    !EXPECTED_CATALOG.test(expectedCatalogSha256 ?? '') ||
    rest.length !== 1 ||
    !/^\d{1,16}\.\d{1,16}\.\d{1,16}$/u.test(rest[0])
  )
    throw new CommercialReleaseError(USAGE);
  return { version: rest[0], expectedCatalogSha256 };
}

export async function promoteFromCli(
  argv,
  { env = process.env, createStore = createStableReleaseStore, keySet = readReleaseKeys() } = {},
) {
  const { version, expectedCatalogSha256 } = parsePromotionArguments(argv);
  const store = await createStore(commercialStoreInput(env));
  return promoteCommercialRelease({ store, keySet, version, expectedCatalogSha256 });
}

/** The line printed when promotion fails; see printableRefusal. */
export function promotionFailureMessage(error, env = process.env) {
  const message = printableRefusal(error, env);
  return message === null ? GENERIC_FAILURE : `Commercial promotion failed: ${message}`;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  promoteFromCli(process.argv.slice(2))
    .then((result) =>
      console.log(
        `Commercial release ${result.version}: ${result.status} to the stable ring. Stable catalogue SHA-256: ${result.catalogSha256}.`,
      ),
    )
    .catch((error) => {
      console.error(promotionFailureMessage(error));
      process.exitCode = 1;
    });
}
