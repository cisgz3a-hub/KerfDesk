// Promotes one commercial release from the beta ring to the stable ring
// (ADR-541): the operator's counterpart of the release train's daily
// promotion, for a release published by hand. It copies the release's signed
// beta entry, byte for byte, into the catalogue that shipped clients and the
// download page read. Nothing is built or signed again. Run one publisher at a
// time: the release train holds the kerfdesk-commercial-publication group.
//
// usage: node scripts/promote-commercial-release.mjs <version>
// env:   COMMERCIAL_R2_API_TOKEN, COMMERCIAL_CLOUDFLARE_ACCOUNT_ID
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promoteCommercialRelease } from './commercial-release-rings.mjs';
import { createStableReleaseStore } from './stable-release-store.mjs';
import { commercialStoreInput, readReleaseKeys } from './release-train.mjs';

export async function promoteFromCli(
  argv,
  { env = process.env, createStore = createStableReleaseStore, keySet = readReleaseKeys() } = {},
) {
  const [version, ...extra] = argv;
  if (version === undefined || extra.length > 0)
    throw new Error('Usage: promote-commercial-release.mjs <version>');
  const store = await createStore(commercialStoreInput(env));
  return promoteCommercialRelease({ store, keySet, version });
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  promoteFromCli(process.argv.slice(2))
    .then((result) =>
      console.log(`Commercial release ${result.version}: ${result.status} to the stable ring.`),
    )
    .catch((error) => {
      // Messages name inputs and object keys, never credentials.
      console.error(`Commercial promotion failed: ${error.message}`);
      process.exitCode = 1;
    });
}
