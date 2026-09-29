# Public Preview distribution from private source

Preview remains free, unsigned and manually installed. The desktop checks one
bounded signed metadata document per launch; it never downloads an installer.
Commercial signed Windows updates use a separate namespace and trust contract.

## Published objects

The fixed public origin is `https://dl.kerfdesk.com`. The R2 bucket is
`kerfdesk-downloads`. Each Preview reserves
`desktop/previews/<version>/publication-reservation.json`, then publishes the three installers,
checksums, source manifest, CycloneDX SBOM and release notes named in that signed
manifest. Only after every artifact is read back and compared does publication
expose the consumer `desktop/previews/<version>/release.json`, then promote
`desktop/previews/latest.json`. Versioned objects are immutable; the
latest metadata object is `no-store`. No executable has a mutable alias.

The publisher rejects older versions, changed bytes for an existing version,
invalid prior signatures and incomplete readbacks. Reruns reuse a reserved
manifest and fill missing objects only. Publication runs under the single
`kerfdesk-preview-publication` GitHub concurrency group. The final pointer is
re-read immediately before promotion. This protects serialized workflow runs;
it is not a distributed lock against an administrator writing directly to R2.

## Publisher signature and proof boundaries

`release.json` is an Ed25519 envelope with `schemaVersion: 1`, `keyId`,
`algorithm: "Ed25519"`, `payload` and `signature`. Both byte fields use canonical
standard base64. The signature covers the exact decoded UTF-8 payload bytes.
The bounded payload binds the Preview version, source SHA/ref, original
publication time, exact artifact names/sizes/SHA-256 hashes and workflow run.
Artifact URLs are always derived from the fixed origin and validated names.

`public/desktop-release-keys.json` is the independent trust anchor:

```json
{
  "schemaVersion": 1,
  "keys": [
    {
      "keyId": "preview-2026-09",
      "algorithm": "Ed25519",
      "channel": "preview",
      "publicKeySpki": "<base64 DER public key>"
    }
  ]
}
```

The Electron app reads its packaged key set, never a key supplied by the download
server. The download page reads its own website's key set. Stable keys have
`channel: "stable"` and cannot authorize a Preview. Keep old anchors while old
releases need verification; publish new anchors before signing with a new key.

Public source releases retain native-builder and companion GitHub attestations
and their verification. Private-source releases require the publisher signature
because GitHub artifact attestations are unavailable on private Free repositories.
Their provenance is explicitly `publisher-signature`. This proves approval by
the signing key holder, not independent builder provenance, operating-system code
signing, notarization or hardware qualification. Internal GitHub archives still
require published immutable prereleases and exact-source checks.

To verify independently with Node 22 and a trusted checkout/public key set:

```sh
node scripts/verify-preview-release.mjs release.json trusted-keys.json downloaded-assets
```

Omit the last argument to verify only metadata. Obtain the public key anchor
through a trusted installation or website, not alongside an untrusted artifact.

## Provisioning contract

The release workflow uses these values only in its final publication step:

| Name | Type | Purpose |
| --- | --- | --- |
| `DESKTOP_PREVIEW_MANIFEST_PRIVATE_KEY` | Secret | Ed25519 PKCS#8 PEM signing key; never commit or bundle it |
| `DESKTOP_PREVIEW_MANIFEST_KEY_ID` | Variable | Matching checked-in Preview key ID |
| `PREVIEW_CLOUDFLARE_ACCOUNT_ID` | Variable | Verified account owning the download bucket |
| `PREVIEW_R2_API_TOKEN` | Secret | Bucket-scoped object read/write access and bucket read access |

Before the first release, configure the bucket's production custom domain and
GET/HEAD CORS for `https://kerfdesk.com` (and any explicitly supported alternate
website origin). Ensure caching rules respect `no-store` for latest metadata;
do not apply a cache-everything override. Versioned downloads use one-year
immutable cache headers. Purge any cached missing metadata after initial setup
or a CORS change. The Cloudflare object REST API used here limits each object to
300 MB; publication fails closed above that limit.

Verify the public custom domain, metadata response/CORS/cache headers and a
complete fresh-browser download after provisioning. Source tests, mocked R2
readbacks and package checks do not establish that external state.

The maintainer still creates the annotated release tag. The cadence workflow
only opens the reminder issue; this change grants no automatic tagging bypass.
Cadence and changelog baselines require both the immutable source archive and a
successful completed canonical release workflow. A failed R2 upload therefore
cannot close the reminder or hide changes in the next Preview's notes. Fetch
that authenticated, filtered history locally with
`node scripts/filter-completed-previews.mjs --fetch preview-releases.json`.
