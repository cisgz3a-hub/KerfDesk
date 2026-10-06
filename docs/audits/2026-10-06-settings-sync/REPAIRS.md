# Settings and sync audit repairs

Date: 2026-10-06. Baseline: `6c62d5a6bfd16210a9c6fa340e60722dba4edad0`, the source used for unsigned Windows 1.0.10. This report describes the follow-up repairs to findings F-01 through F-07. Source and local verification are distinct from a published installer, a live provider deployment and physical-machine qualification.

## Completed changes

| Finding | Result | Regression coverage |
| --- | --- | --- |
| F-01: keeping current hardware replaced the opened CNC job | Retain the selected machine's physical parameters while preserving the opened document's stock, material, cutter definitions, selected tool, operation bindings and tiling. Active and parked CNC heads use the same ownership rule. New creates a fresh job with retained physical parameters. | All four Laser/CNC head combinations; stale or missing hardware mirrors; same-ID cutters; tiling registration; per-head placement/output; Undo/Redo; Save/reopen; New; actual compiler/G-code checks. |
| F-02: preference saves failed silently and could trim history | Failed writes keep the latest choice per preference, show a Settings warning and offer **Retry saving settings**. A partial retry retains the outstanding warning. Same-value nudge/snap commits retry pending writes. The Recent Projects limit is displayed as pending, preserves history until saved and uses the last saved limit for new entries. | Quota refusal; denied storage getter; recovery; latest and partial retries; independent fresh reads; mounted Settings; record/refresh/retry ordering; actual Chromium failure/retry/reload. |
| F-03: phone retained private review details after sharing stopped | Retire cached details when sharing, revision or session changes. Revalidate both the session and workspace before delivering held responses; previously shared review wording cannot return through an old response. | Sharing-off at the same revision; held review and final workspace responses; disconnect/replaced client; hidden/pagehide transitions. |
| F-04: phone Settings displayed stale facts as Live | Refresh computer/job details while their disclosure is open, about every ten seconds. Opening it explicitly obtains current facts; collapsed/hidden/paused views do not prepare periodic details. Machine status/receipt reads share the read queue and recheck ownership after waiting. Explicit Frame and Abort are not queued behind those reads. | Changed profile/bed, edition, update highlights, recipes and Frame; collapsed and reopened disclosure; mixed-revision rejection; stale drafts; paused/hidden views; read concurrency; immediate explicit controls. |
| F-05: Save left the phone's Unsaved badge stale | Refresh save metadata even when the document revision is unchanged, without replacing editor fields, carets, selections, partial numeric drafts or previews. | Real desktop dirty/revision projection; focused partial input and same-revision Save on app/phone layouts. |
| F-06: denied camera cleanup discarded a readable choice | Return the sanitized RTSP or phone-camera choice even if best-effort legacy cleanup cannot be written. Never return the legacy login, query or fragment. | Cleanup denial followed by healthy reread; credential removal; explicit port retention; existing camera-query/security tests. |
| F-07: small imported firmware numbers used exponent syntax | Encode finite setting values as bounded decimal words. Preserve supported existing spelling, use compact spelling where necessary, and surface actual parser loss, overflow or underflow before transport or qualification state changes. Keep existing `$32` and controller-family rules. | Wizard comparison and batch selection; real store write/readback; stock GRBL and grblHAL parser boundaries; `$30=0.0000001`, `.00000001`, `.00000011` and `.01050001`; ordinary/native float precision; raw `$32` and line-size limits. |

## Verification

- CNC ownership: 35 focused tests across eight files passed. A subsequent refactor passed all 11 tests in the three affected files.
- Preferences/camera: 86 focused tests across 13 files passed; after the final warning/retry changes, all 20 tests in the three affected files passed.
- Firmware: the final frozen-source run passed 162 tests across nine files.
- Phone: 85 affected browser tests passed with no skips, and the complete phone/MCP service suite passed all 396 tests. After the first hosted run exposed a test response-delivery race, all 43 tests in the affected browser files passed with the corrected synchronization. An earlier 104-test run included the workspace scenarios. These runs overlap and must not be added as distinct coverage.
- Complete renderer Chromium scenarios: all nine passed with no skips or retries. They cover blank numeric retyping, operation/toolbar/Machine Setup fields, failure/retry/reload, computer preferences through Open/New, immediate Save As and real autosave recovery.
- Direct visible Chrome inspection confirmed blank-to-number editing, a decimal grid value and preference retention after reload.
- The full renderer typecheck passed against the frozen source. Browser-test and remote-service typechecks passed. Full root ESLint and subsequent scoped lint, source formatting, file-size/export guards and whitespace checks passed.
- The Worker dry run passed and retained the existing fixed Worker, account and dedicated OAuth bindings. This is local packaging evidence only.
- Both the desktop renderer and browser-Free production builds passed. The Electron main-process compile and installer-terms preparation also passed without changes to the EULA.

The initial combined renderer run passed six of eight scenarios but was invalidated by development-server reloads while source files were still being edited. The later nine-scenario run used frozen source and passed. The full remote-service run also exposed older startup tests waiting on detail reads that must now stay absent while the disclosure is closed; their replacement checks retain the mandatory fresh workspace admission contract.

The first hosted phone run passed 395 of 396 tests. Its close/reopen privacy regression incorrectly treated the fixture handler becoming idle as browser response completion. A forced browser-delivery barrier reproduced the exact timeout. The corrected test waits for the retired refresh to finish, witnesses the next fresh read and still requires no private detail to be painted. Production code and assertion timeouts did not change.

Reproduction uses the ordinary repository and remote-service test scripts in a fresh checkout. The local audit worktree used direct installed Node entrypoints and a test-only filesystem allowlist for its linked dependency directory; no runtime Vite configuration was changed.

## Delivery and qualification boundaries

Merge requires successful checks for the exact PR head. Main CI, web publication and phone publication require their own evidence. This repair does not silently request an early desktop release: the standing ten-merged-PR batch rule remains in force unless the maintainer requests a release sooner.

No physical controller was operated. No claim here proves material results, native Windows upgrade/profile retention, live customer trial/licence activation, or a hosted ChatGPT pairing. The normal Frame/Start contract and Pro admission scope are unchanged.

Firmware reference implementations: [stock GRBL float parser](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/nuts_bolts.c#L20-L97), [grblHAL float parser](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/nuts_bolts.c#L238-L294) and [grblHAL setting formats](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2171-L2285). Local build and deployment checks follow [Wrangler's deployment commands](https://developers.cloudflare.com/workers/wrangler/commands/) and [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/).
