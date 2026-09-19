# Electron readiness integration — 19 September 2026

This follow-up integrates the eight Electron readiness fixes with current main.
The [12 September build report](2026-09-12-electron-readiness-build.md) remains
historical evidence for source `d3afa030c263d5ff6f68ca5342cf01b20af78498` and its
unsigned local installer. Its test counts and binary hashes do not describe a
later integration candidate.

The reconciliation preserves main's nonblocking autosave recovery banner beside
the desktop close notice. It keeps the Frame/Start policy unchanged and preserves
the original dirty checkout. Work is isolated on
`codex/electron-readiness-20260912`.

## Additional source changes

- Electron is pinned to **42.11.5**, with the corresponding lockfile and notices.
  This remains in the existing major line and retains the declared macOS minimum.
  The [upstream release](https://releases.electronjs.org/release/v42.11.5) includes
  additional Chromium/graphics-engine backports since the earlier candidate.
  Version 42.11.6 was evaluated but rejected by the frozen-install release-age
  gate because it was less than a day old. The temporary exception automatically
  added by pnpm was removed; no dependency-age policy was relaxed. Frozen install
  succeeds for 42.11.5.
- Stable workflow retries now recognise a Windows build explicitly skipped
  before any steps executed. Previously, a tag-validation failure could leave
  every retry blocked by missing build-step evidence. The fix accepts only a
  completed, correctly identified skipped job with no executed steps. Cancelled
  or unknown histories, incomplete API responses, and lost artifacts after a
  successful upload remain failures.

## Independent review and focused verification

Three bounded reviews revisited actual source, failure paths and tests after
reconciliation, rather than relying on the earlier audit conclusion.

| Area | Outcome | Focused evidence |
| --- | --- | --- |
| Close/quit and permission lifetime | No additional confirmed defect. Reviewed pending stop ownership, cancellation/retry, document/run revalidation, unavailable renderers and update installation on final quit. | 61 tests across 12 files pass on the eligible dependency state. |
| Stable publication and retries | One reproduced skipped-build retry defect fixed. Immutable staging, alias/feed recovery and artifact restoration were rechecked against current GitHub/Cloudflare contracts. | 39 publisher/store/artifact/retry tests and 20 workflow tests pass; scoped lint and formatting pass. |
| HTTP/RTSP input handling | No additional confirmed defect. Actual decoded gzip limits, cancellation, partial responses and deadlines were challenged with synthetic peers. | 72 tests across nine files and ten real loopback HTTP/TCP probes pass. |

Focused counts overlap the full suite and must not be added to aggregate counts.
The first pnpm-wrapped attempts rejected 42.11.6 before test execution; those logs
are retained separately from the successful checks. Camera tests also passed via
the already installed Vitest runner without changing dependency policy.

Full release, browser and packaged-app results are recorded against the final
candidate in its pull request and local receipts under
`artifacts/electron-integration-20260919/`. A green PR check applies to its exact
head; merged-main CI and web deployment are separate results. Merging these
changes does not enable the stable desktop release environment or publish a
desktop installer.

## Remaining qualification boundaries

- Windows installer execution, native file-dialog disk persistence, old-profile
  migration, repair/uninstall and installed-path offline operation require their
  own installed-app evidence. The native smoke substitutes file pickers.
- Signed installed N-to-N+1 upgrades, signer continuity, interrupted downloads,
  live R2/CDN publication and recovery require the production signing/release
  environment. Certificate and account provisioning are outside this task.
- macOS Intel/Apple Silicon packaging, permissions, window recreation,
  signing/notarization and update qualification require supported Mac hosts.
- No physical controller/camera or FFmpeg operation is claimed. Synthetic stop
  completion is software handoff evidence, not physical stopping or forced-OS-
  shutdown qualification. Hardware operation remains separately authorised.
