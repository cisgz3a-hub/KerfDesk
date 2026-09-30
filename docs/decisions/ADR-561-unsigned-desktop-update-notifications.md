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
6. A main-only GitHub workflow publishes a new immutable patch version after CI, Browser smoke and Desktop package check all succeed for that exact main push. The protected `desktop-commercial` environment holds the existing release metadata signing key and scoped R2 credentials. A repository switch, `KERFDESK_UNSIGNED_RELEASES=on`, enables this lane. Failed checks do not publish. Branch pushes do not publish. Historical signed and Preview lanes remain separate.
7. Publication remains serialized and advances the authenticated latest pointer only after package verification and remote byte readback. Interrupted immutable versions are never overwritten. A provider rate limit restarts the same publication after its Retry-After delay, rechecking current latest first; it never blindly retries a delayed pointer write. The existing unsigned installer, EULA and licence terms are unchanged.

### Consequences and evidence boundary

Users on 1.0.0 must download and install the first notification-capable release once. Windows may still display unknown-publisher warnings. An update opens the normal interactive installer after closing; it is not silent installation. Installed native handoff, live publishing, browser deployment and licence delivery must each be reported from their own evidence rather than inferred from passing checks.

The implementation follows the pinned electron-builder v26 APIs, not the unreleased v27 documentation:

- [electron-builder v26 update documentation](https://www.electron.build/v26/docs/features/auto-update/)
- [Electron app.relaunch and lifecycle events](https://www.electronjs.org/docs/latest/api/app)
- [GitHub workflow_run permissions and trigger behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
