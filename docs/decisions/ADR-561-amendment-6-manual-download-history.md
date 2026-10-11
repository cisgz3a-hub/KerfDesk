## ADR-561 Amendment 6 - Retain discoverable manual installer history

Date: 2026-10-11

Status: Accepted for implementation by the maintainer's request to fix the payment audit findings. Publication evidence remains separate.

### Context

A paid licence keeps Pro access to releases covered by its update year. The download page exposed older code-signed releases, but the current manual Windows lane exposed only `latest.json`. Once the latest release exceeded that year, the customer had no list from which to find a covered installer. This resolves the website limitation recorded in ADR-561 decision 5.

### Decision

1. Publish `desktop/commercial-manual/catalog.json` containing the original, independently stable-key-signed per-version download manifests. Each browser record must pass the existing manual manifest signature, product, stable channel, version, source, date, artifact name, size and hash checks. The catalogue cannot supply download URLs. The existing download host and versioned paths are computed from verified fields. The original manual manifest schema and installed updater remain unchanged.
2. Show verified earlier installers on `/download.html`, with release dates and SHA-256 hashes. Preserve manual releases when the code-signed lane starts, preferring the signed copy of a version present in both lanes. `?version=1.0.14` selects that exact stable release. An unavailable or unverifiable requested version never silently selects latest. Preview version selection keeps its existing meaning.
3. The first normal manual publication backfills existing immutable manual manifests through a bounded, complete R2 object listing. It verifies each manifest and its version path, requires the corresponding installer object, and excludes versions beyond the authenticated previous latest. It preserves every historical record on later publications. A 128-release or 512-KiB limit refuses publication until reviewed pagination is added; it never prunes customers' covered versions.
4. Verify the candidate installer and immutable objects first. Recheck the reviewed latest and initial history, write and read back history, then recheck and promote latest. Browsers cap the index at authenticated latest, so an interrupted history-first write cannot offer a future candidate. Identical retries converge. Existing shared workflow serialization is required; these read/compare/write checks are not a storage-level compare-and-swap against uncoordinated administrator writes.
5. Existing deployments without a catalogue still offer verified latest. Exact older-version links can verify the immutable manual manifest directly when its version does not exceed authenticated latest. Missing or corrupt history displays support guidance while leaving independently verified latest available. It never falls back from an invalid code-signed catalogue to an unsigned release.

### Rollout and verification

Deploying the website enables history reading and exact-version selection. The next authorised normal manual Windows publication creates and backfills the R2 catalogue; merging this source alone does not populate the live archive. An identical previously published candidate can also create a missing catalogue through the existing publisher, subject to its existing operator and package qualifications. No new unattended release or provider mutation is introduced.

Focused tests cover original signature and download checks, numerical version ordering, mixed signed/manual history, exact-version success and refusal, absent and corrupt history, interrupted publication, concurrent mutable-state changes, historical backfill, immutable path conflicts, missing historical installers, complete bounded listing, and refusal to prune a full history. Native installation and live publication still need their own evidence.

R2 listing follows the [Cloudflare object-list API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list/), including `prefix`, `cursor`, `per_page` and `result_info.is_truncated`.
