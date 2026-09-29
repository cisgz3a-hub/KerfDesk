# Commercial Windows publication

The publisher is an operator CLI, and the weekly release train (`.github/workflows/release-train.yml`, ADR-541) runs the same CLI. The train is off until the owner sets the repository variable `KERFDESK_RELEASE_TRAIN` to `on`; see "Weekly release train" in `docs/desktop-commercial-launch.md`. Neither creates GitHub releases, tags, accounts or signing credentials. Run the publisher by hand on Windows from a clean checkout whose HEAD matches the approved signed source SHA. Build outputs and generated preparation files must be ignored or outside that checkout.

First run `prepare-commercial-desktop.mjs` with the explicit release timestamp, approved external seller terms and the protected stable signing key. Its `--source-ref` is the release tag (`refs/tags/vX.Y.Z`) for a hand release; the train, which never tags, uses `refs/heads/main`. Build with its generated configuration and retain its `commercial-release-identity.json`. The build must use a valid Windows Authenticode certificate and the approved publisher name.

Set these protected environment inputs without putting their values in command history:

- `DESKTOP_STABLE_MANIFEST_PRIVATE_KEY`: Ed25519 PKCS8 PEM matching the checked-in stable public key.
- `DESKTOP_STABLE_MANIFEST_KEY_ID`: that stable key's ID.
- `DESKTOP_WINDOWS_PUBLISHER_NAME`: the Windows certificate publisher, also pinned in `app-update.yml`.
- `COMMERCIAL_CLOUDFLARE_ACCOUNT_ID`: the explicitly verified account hosting `kerfdesk-downloads` and `dl.kerfdesk.com`.
- `COMMERCIAL_R2_API_TOKEN`: restricted R2 access to that account and bucket.

```text
node scripts/publish-commercial-release.mjs <release-directory> <commercial-release-identity.json> <packaged-resources-directory>
```

The resources directory must contain the actual packaged `app.asar` and `app-update.yml`. The CLI verifies independently pinned release and entitlement keys, the exact signed prebuild identity, Authenticode status and publisher, and both resources streamed directly from the installer with electron-builder's pinned 7za. It repeats the native signer and embedded-resource checks on uploaded bytes. It does not install the application.

## Two rings: beta first, then stable

Publication reserves `desktop/commercial/releases/X.Y.Z/publication-reservation.json`, uploads and reads back the three immutable update artifacts, then publishes `update-manifest.json`. Only then does it replace the beta catalogue, `desktop/commercial/beta/catalog.json`, with `Cache-Control: no-store`. The stable catalogue, `desktop/commercial/catalog.json`, is what every device reads unless its owner ticked "Get new versions early (beta)" in Help > Licence, and what the download page shows. Publication never changes it. The legacy stable feed and Preview lane are untouched.

The beta catalogue lists every beta and every stable release. A new release must be newer than the newest release in either catalogue, and publication stops if the two disagree about a version. An exact interrupted retry resumes the same reservation, and a retry of a release published before the rings existed adds its missing beta entry; changed bytes, rollback, malformed prior history or a moved catalogue stop publication.

Promotion copies one beta entry, byte for byte, into the stable catalogue. Nothing is signed again, so it needs only the two R2 inputs above, never the signing key:

```text
node scripts/promote-commercial-release.mjs <version>
```

It first proves that the release's `update-manifest.json` is that exact entry and that each artifact still matches its signed size and hashes. It refuses a version beta does not list, a different envelope already on stable, a rollback, a backdated release, a full stable catalogue and a stable catalogue that moved while it ran. It prints `promoted`, or `already-promoted` when stable already lists that exact entry. A hand promotion skips the train's quiet days, so use it for an urgent fix or a pilot release.

Do not run two publishers or promotions concurrently. The train's build and promote jobs share the `kerfdesk-commercial-publication` concurrency group, so do not publish or promote by hand while a train run is in progress. The final comparison detects observed concurrent changes but is not a distributed lock against direct bucket administrators.

## The release train

`node scripts/release-train.mjs <command>` holds the train's decisions; the workflow runs it.

- `decide` (Tuesdays): is a beta due, from which green main commit, as which `<ISO week-year>.<ISO week>.<patch>` version.
- `preflight`: every secret and variable is set, the signing key is the pinned one, the bucket answers and the approved terms match `KERFDESK_COMMERCIAL_TERMS_SHA256`.
- `terms`: fetches the approved terms from `https://dl.kerfdesk.com/desktop/commercial/terms/<sha256>.txt` and checks their hash.
- `promote` (daily): promotes the newest beta after 4 quiet days unless a newer beta replaced it, an open issue is labelled `release-hold` or `KERFDESK_RELEASE_HOLD` is `on`.
- `status`: reports both rings and the promotion decision from the public catalogues. It needs no secrets.

## Limits and evidence

Each catalogue retains every prior eligible release. It fails at 65 releases or 256 KiB instead of dropping history needed by customers whose update entitlement expired. The beta catalogue lists every release, so it reaches that bound first: about 15 months of weekly releases. Reviewed pagination or archival support is required before reaching that limit. Each upload is limited to the R2 object API's 300 MB bound.

The Ed25519 signature proves the approved key signed these bytes and the asserted source identity. It is not an independently hosted build attestation or proof of a reproducible build. A clean matching checkout and installer pairing add local evidence; signed installation, upgrade, hosted download and licence qualification remain required before launch. Public GitHub attestations may supplement this evidence when available.
