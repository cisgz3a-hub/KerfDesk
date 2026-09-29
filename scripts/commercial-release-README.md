# Commercial Windows publication

The publisher is an operator CLI. It does not create releases, tags, accounts or signing credentials, and no commercial publication workflow is enabled yet. Run it on Windows from a clean checkout whose HEAD matches the approved signed source SHA and whose `vX.Y.Z` tag resolves to that same commit. Build outputs and generated preparation files must be ignored or outside that checkout.

First run `prepare-commercial-desktop.mjs` with the explicit release timestamp, approved external seller terms and the protected stable signing key. It refuses any identity the publisher would refuse: `--source-ref` must be `refs/tags/vX.Y.Z` for the version, and `--published-at` no more than five minutes ahead. Build with its generated configuration and retain its `commercial-release-identity.json`. The build must use a valid Windows Authenticode certificate and the approved publisher name.

Set these protected environment inputs without putting their values in command history:

- `DESKTOP_STABLE_MANIFEST_PRIVATE_KEY`: Ed25519 PKCS8 PEM matching the checked-in stable public key.
- `DESKTOP_STABLE_MANIFEST_KEY_ID`: that stable key's ID.
- `DESKTOP_WINDOWS_PUBLISHER_NAME`: the Windows certificate publisher, also pinned in `app-update.yml`.
- `COMMERCIAL_CLOUDFLARE_ACCOUNT_ID`: the explicitly verified account hosting `kerfdesk-downloads` and `dl.kerfdesk.com`.
- `COMMERCIAL_R2_API_TOKEN`: restricted R2 access to that account and bucket.

```text
node scripts/publish-commercial-release.mjs --expected-catalog-sha256 <64-hex|none> <release-directory> <commercial-release-identity.json> <packaged-resources-directory>
```

`--expected-catalog-sha256` states the catalogue you reviewed: the SHA-256 of the live `desktop/commercial/catalog.json`, which the previous publication printed, or `none` only when no commercial catalogue exists yet. The publisher refuses before any write when the live catalogue differs, so a truncated, deleted or replaced catalogue is never accepted and then made permanent. The one exception is an identical retry after its own catalogue promotion landed: the live catalogue is then exactly the expected one plus that release, and the retry reports `already-published`. Each run prints the resulting catalogue SHA-256; record it for the next publication.

The resources directory must contain the actual packaged `app.asar` and `app-update.yml`. The CLI verifies independently pinned release and entitlement keys, the exact signed prebuild identity, Authenticode status and publisher, and both resources streamed directly from the installer with electron-builder's pinned 7za. It repeats the native signer and embedded-resource checks on uploaded bytes. It does not install the application.

Publication reserves `desktop/commercial/releases/X.Y.Z/publication-reservation.json`, uploads and reads back the three immutable update artifacts, then publishes `update-manifest.json`. Only then does it replace `desktop/commercial/catalog.json` with `Cache-Control: no-store`. The legacy stable feed and Preview lane are untouched. An exact interrupted retry resumes the same reservation; changed bytes, rollback, malformed prior history or a moved catalogue stop publication. Do not run two publishers concurrently; a future workflow must share the `kerfdesk-commercial-publication` concurrency group. The final comparison detects observed concurrent changes but is not a distributed lock against direct bucket administrators.

The catalogue retains every prior eligible release. It fails at 65 releases or 256 KiB instead of dropping history needed by customers whose update entitlement expired. Reviewed pagination or archival support is required before reaching that limit. Each upload is limited to the R2 object API's 300 MB bound.

The Ed25519 signature proves the approved key signed these bytes and the asserted source identity. It is not an independently hosted build attestation or proof of a reproducible build. A clean matching checkout and installer pairing add local evidence; signed installation, upgrade, hosted download and licence qualification remain required before launch. Public GitHub attestations may supplement this evidence when available.
