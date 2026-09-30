## ADR-561 - Unsigned Windows update notifications and explicit installation

Date: 2026-09-30

Status: Accepted by the maintainer's request to notify users and let them update after pushes; implementation and release evidence tracked separately.

### Context

The first production licensed Windows installer, 1.0.0, is intentionally unsigned. It has a verified download manifest but no in-app update notifications. The maintainer requested update notifications and an update action, without buying a signing certificate. The normal signed updater must continue requiring its existing trust contract. Machine work and unsaved projects must retain their existing close safeguards.

### Decision

1. Prepared production unsigned Windows x64 builds use a separate manual update service. It reads the fixed `commercial-manual/latest.json` URL, verifies the independently pinned stable Ed25519 signature, and rejects wrong products, versions, backdated releases, artifact names, sizes, hashes and origins. The metadata signature authenticates the publisher's bytes; it is not Windows Authenticode signing.
2. Check at startup and every 30 minutes. Display an in-app notification and, where supported, a Windows notification once per available version per session. Help > Updates retains a manual check. An unsigned build does not offer the signed beta channel.
3. The user chooses **Download update**, then separately **Install when I close KerfDesk**. The main process derives the URL and cache path, streams and verifies the exact signed bytes, and re-verifies the signature, licence eligibility and cached installer before arming and at quit. Consent is session-local. A restart does not restore installation consent; stale owned cache files are pruned.
4. No update action closes, restarts or kills the app. Only completion of the existing approved ordinary close can schedule the interactive installer after the app exits. Cancelled close, renderer failure, forced close, reload and Windows session end do not authorise installation. The ADR-555 NSIS running-app override remains in place. Frame, Start, output, exports and running jobs gain no entitlement or update gate.
5. Free installations receive current releases. Paid licences retain their existing update coverage; developer/family perpetual coverage remains perpetual. Revoked or unverifiable credentials do not authorise an update. The latest-only manual manifest can report that the newest release is not covered; selecting older covered versions remains a limitation until a signed manual catalogue is added.
6. A main-only GitHub workflow publishes a new immutable patch version after at least 20 merged PRs since the authenticated previous release source, and after CI, Browser smoke and Desktop package check all succeed for that exact main push. An explicit manual `release_now` dispatch can release a smaller batch, as described in Amendment 1 below. It also checks current dependency advisories and installs, launches and uninstalls the actual production candidate on a disposable Windows runner. The protected `desktop-commercial` environment holds the existing release metadata signing key and scoped R2 credentials. A repository switch, `KERFDESK_UNSIGNED_RELEASES=on`, enables this lane. Failed checks do not publish. Branch pushes do not publish. Historical signed and Preview lanes remain separate.
7. Publication remains serialized and advances the authenticated latest pointer only after package verification and remote byte readback. Interrupted immutable versions are never overwritten. A provider rate limit restarts the same publication after its Retry-After delay, rechecking current latest first; it never blindly retries a delayed pointer write. Download errors on `dl.kerfdesk.com/desktop/` must return `Cache-Control: no-store` at the CDN and browser, so a pre-publication request cannot retain a stale 404 after upload. Successful immutable artifacts keep their long cache lifetime. The existing unsigned installer, EULA and licence terms are unchanged.
8. Browser service-worker discovery also checks every 30 minutes while open. It uses the existing Update button and manual apply safeguards, including separate ownership for each open window; it never reloads another window automatically. Offline failures remain retryable. This is distinct from downloading a Windows installer.

### Consequences and evidence boundary

Users on 1.0.0 must download and install the first notification-capable release once. Windows may still display unknown-publisher warnings. An update opens the normal interactive installer after closing; it is not silent installation. Installed native handoff, live publishing, browser deployment and licence delivery must each be reported from their own evidence rather than inferred from passing checks.

The implementation follows the pinned electron-builder v26 APIs, not the unreleased v27 documentation:

- [electron-builder v26 update documentation](https://www.electron.build/v26/docs/features/auto-update/)
- [Electron app.relaunch and lifecycle events](https://www.electronjs.org/docs/latest/api/app)
- [GitHub workflow_run permissions and trigger behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
- [Cloudflare Cache Response Rules and no-store](https://developers.cloudflare.com/cache/how-to/cache-response-rules/)

### Amendment 1 - Batch automatic releases after 20 merged PRs

Date: 2026-09-30. Accepted by the maintainer's explicit instruction: "Set a rule that we do 20 PRs before a release or if otherwise instructed".

Automatic Windows releases require at least 20 unique PR numbers merged into this repository's `main` whose integration commit is reachable from the candidate but not from the authenticated latest release's `sourceSha`. GitHub's merged `merge_commit_sha` identifies the merge commit, squash commit or final rebased commit. Open PRs, closed unmerged PRs, PRs targeting another branch, direct commits and already included merges do not add to the count. Reverting a change does not erase the earlier merged PR from this history. A PR merged while the previous installer was building still counts if that installer did not include its integration commit; publication and merge timestamps are not the cutoff.

The Linux qualification job checks the batch before starting a Windows runner. The Windows planner re-verifies the authenticated latest pointer and the same count before dependencies or packaging. It reads the complete GitHub PR listing in ascending creation order with all states included, so merging, closing or editing a PR cannot reorder the pages. Enumeration is bounded to 100 pages of 100 records, 30 seconds per request, two minutes overall and 16 MiB per page. Missing permissions, API/rate-limit failures, malformed records, duplicate pagination or an incomplete listing refuse publication rather than supplying a guessed count. The workflow has read-only pull-request permission. Its summary records the count and whether a manual override was selected.

The **Release unsigned Windows desktop** manual workflow input `release_now` is a boolean defaulting to false. Only an explicit true selection on `main` bypasses the 20-PR threshold. A manual dispatch without that selection follows the batch rule. The override retains exact-main successful checks, a clean source checkout, previous-source ancestry, authenticated manifests, package verification, Windows qualification and publication guards. API uncertainty still refuses a manual release when a previous release exists. The initial release, which has no authenticated baseline, requires an explicit release-now dispatch. Duplicate published source remains a no-op even with the override.

Reference: [GitHub's merge commit SHA semantics](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request) and [pull request listing and pagination](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests).
