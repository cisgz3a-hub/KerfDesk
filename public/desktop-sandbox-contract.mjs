// Qualification only. These anchors are never accepted by commercial publication.
// The entitlement pin was read from the existing operator's sandbox-trust.json;
// the release pin is public deterministic test material, not a customer signing key.
export const SANDBOX_ORIGIN = 'https://kerfdesk-desktop-licensing-sandbox.cisgz3a.workers.dev';
export const SANDBOX_APP_ID = 'dev.kerfdesk.sandbox';
export const SANDBOX_PRODUCT_NAME = 'KerfDesk Sandbox';
export const SANDBOX_PACKAGE_NAME = 'kerfdesk-sandbox';
export const SANDBOX_DATA_DIRECTORY = 'kerfdesk-sandbox';
export const SANDBOX_ENTITLEMENT_KEYS = Object.freeze({
  'sandbox-20260929': 'MCowBQYDK2VwAyEAhvzfLuKvC5qQ0OUHhraipfIvvbscPKDe4QIcQbSKEyo=',
});
export const SANDBOX_RELEASE_KEYS = Object.freeze({
  'sandbox-release-fixture-v1': 'MCowBQYDK2VwAyEAeMV6JCY1x31EU1jYzyCDD+TQdcwWrB/Mod39GjdmZpY=',
});

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameKeys = (actual, expected) =>
  record(actual) &&
  Object.keys(actual).length === Object.keys(expected).length &&
  Object.entries(expected).every(([key, value]) => actual[key] === value);

/** Partial or corrupt sandbox metadata still selects its separate data directory. */
export function hasSandboxMarker(metadata) {
  return (
    record(metadata) &&
    (metadata.name === SANDBOX_PACKAGE_NAME ||
      metadata.kerfdeskSandbox === true ||
      metadata.kerfdeskDesktopReleaseChannel === 'sandbox' ||
      metadata.kerfdeskCommercialLicense?.apiOrigin === SANDBOX_ORIGIN)
  );
}

/** Every marker and public pin must agree; no arbitrary endpoint or key override. */
export function isSandboxMetadata(metadata) {
  const licence = record(metadata) ? metadata.kerfdeskCommercialLicense : null;
  return (
    record(licence) &&
    metadata.name === SANDBOX_PACKAGE_NAME &&
    metadata.kerfdeskSandbox === true &&
    metadata.kerfdeskDesktopReleaseChannel === 'sandbox' &&
    metadata.kerfdeskUpdateChannelTrusted === false &&
    licence.schema === 1 &&
    licence.apiOrigin === SANDBOX_ORIGIN &&
    sameKeys(licence.entitlementKeys, SANDBOX_ENTITLEMENT_KEYS) &&
    sameKeys(licence.releaseKeys, SANDBOX_RELEASE_KEYS)
  );
}
