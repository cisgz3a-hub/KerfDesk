> Historical archive added 6 September 2026. The report below retains its original July baseline, findings, priorities, source claims and reported checks. Those claims were not rerun or refreshed for this publication. Original task instructions are historical context; current Frame-first and Job Review warning policy remains governing. Its desktop/release observations describe the recorded July revisions. Later desktop and release changes have their own PR evidence; this document is not a fresh release-readiness verdict.

# KerfDesk Electron desktop quality audit

**Audit date:** 2026-07-26
**Audit type:** independent, read-only product/release/runtime audit
**Canonical source:** `C:\Users\Asus\LaserForge\continuous-audit-source`
**Built/runtime-audited revision:** `261695ad2d0aa684f2fa0702747d688e3e92a964` (`HEAD == origin/main` at audit start)
**Final-main delta checked through:** `de36b8674a8abf0c9276f5666ae34e14a3791476`
**Current product name:** **KerfDesk**
**Auditor changes:** this report only; no production code, safety gate, release configuration, or product state was changed.

## Executive verdict

KerfDesk has a notably strong renderer security boundary and a serious Preview release pipeline, but the Electron desktop is **not yet professionally complete or release-qualified end to end**. The current code has four high-priority desktop/release defects: shutdown is not coordinated with an active hardware job, multiple app instances are allowed to share the same state and device surface, stable tags are not required to come from `main`, and the secret-bearing stable workflow uses mutable action tags. Several ordinary desktop expectations are also open, including working external support links, branded application icons, deterministic first-window display, native project-file opening, native crash diagnostics, and packaged-Electron regression coverage.

This is not a claim that KerfDesk's controller logic is broadly unsafe. The controller, recovery, preflight, simulator, and invariant test coverage is extensive. The narrower finding is that **closing the Electron host is not an ordered, acknowledged controller transition**, so a safe physical outcome after window/OS termination is not proven.

The current public Preview is substantially better than old release history suggests: `v0.2.0-preview.13` was produced by a successful workflow and is consistently named KerfDesk. It includes Windows x64 plus macOS x64/arm64 artifacts, SHA-256 sums, a release manifest, an SBOM, and GitHub attestations. Preview remains deliberately unsigned, unnotarized, and not a production update channel.

## Evidence boundary and terminology

- `C:\Users\Asus\LaserForge` is a hub/launcher directory, not the canonical source checkout.
- `C:\Users\Asus\LaserForge-2.0` is a source checkout but was dirty, on a non-main branch, and behind `origin/main`; it was not used as audit truth.
- The audit used the clean detached current-main worktree named above. `HEAD` and `origin/main` both resolved to `261695ad2d0aa684f2fa0702747d688e3e92a964`.
- During the long build/test pass, `origin/main` advanced to `de36b8674a8abf0c9276f5666ae34e14a3791476`. Its only product delta is a `save-tiled-gcode.ts` extraction into `tile-emission.ts`; it does not touch Electron, packaging, release, branding, lifecycle, permissions, data paths, or any finding source. The findings were therefore refreshed as still current through `de36b867`; build/runtime measurements remain tied to `261695a`.
- **Confirmed current** means reproducible from this exact source, build configuration, runtime, or live release state.
- **Historical/fixed** means an older issue or name remains in history/context but the audited current surface is corrected.
- **Recommendation** means professional hardening or coverage work whose absence is not necessarily a current malfunction.
- **Not qualified** means code/tests are not enough; a real supported OS, installer, updater, permission prompt, controller, camera, or machine is required.
- `dev.laserforge.app`, `%APPDATA%\laserforge`, package-format identifiers, and similar persisted identifiers are intentional compatibility identity, not user-facing branding defects.

## Confirmed current findings

| ID | Priority | Area | Finding and evidence | Professional impact |
| --- | --- | --- | --- | --- |
| KD-ELEC-001 | **P1** | Hardware boundary / shutdown | `src/ui/app/use-unload-stop.ts:21-38` starts `void state.stopJob()` from `beforeunload`/`pagehide` but neither prevents close nor awaits controller acknowledgement. `electron/main.ts` has no `BrowserWindow.close`/renderer handshake; `before-quit` also starts camera shutdown without awaiting it. `WORKFLOW.md:4256-4260` overstates this as a quit path that cannot proceed while a job runs. | Window close, app quit, update-on-quit, logout, or process termination is not a deterministic controller transition. Whether a particular controller stops safely is **not hardware-qualified**. |
| KD-ELEC-002 | **P1** | Stable release provenance | `.github/workflows/release-desktop-stable.yml:31-47` verifies SemVer and annotated-tag shape but never fetches `main` and never runs `git merge-base --is-ancestor`. The Preview workflow does this at lines 22-38. | An annotated stable tag on a stale or non-main commit can publish a signed installer and advance the production update feed. |
| KD-ELEC-003 | **P1** | Release supply chain | The secret-bearing stable workflow uses mutable refs such as `actions/checkout@v7`, `actions/setup-node@v6`, `pnpm/action-setup@v6`, and `actions/upload-artifact@v7` (`release-desktop-stable.yml:36,41,56,66,69,146`). Preview uses full commit SHAs. GitHub documents a full SHA as the only immutable action reference. | A moved or compromised upstream action tag would execute in the production release environment. |
| KD-ELEC-004 | **P1** | Lifecycle / state / devices | There is no `app.requestSingleInstanceLock()`, `second-instance` handler, or equivalent. Every process pins `userData` and `sessionData` to the same legacy `%APPDATA%\laserforge` directory and can reach the same serial permission/device surface; the camera bridge also contends for fixed loopback port `51731`. | Concurrent processes can race IndexedDB/session state, confuse update/lifecycle ownership, compete for the bridge, or present two operator surfaces for one machine. |
| KD-ELEC-005 | **P2** | UX / external navigation | `Report a Bug` and `Discussions & Feedback` create `target="_blank"` anchors (`src/ui/commands/support-command-family.ts:8-45`). Electron's `setWindowOpenHandler` shells out only the exact release-download URL and denies every other new window (`electron/main.ts:346-358`; `electron/trusted-renderer-policy.ts:59-61`). | These two visible support commands are inert in the desktop app. |
| KD-ELEC-006 | **P2** | Packaging / branding | Both builder files specify `buildResources: build`, but the repository has no `build/` directory and no `.ico`, `.icns`, or application icon asset. The fresh exact-main build explicitly reported `default Electron icon is used`. `package.json` also lacks author/company metadata, and the packaged executable's `CompanyName` is Electron's inherited `GitHub, Inc.` rather than the KerfDesk publisher. | Installer, executable, shortcuts, taskbar, Finder/Dock, version properties, and OS dialogs do not carry a complete professional KerfDesk identity. |
| KD-ELEC-007 | **P2** | Startup / window lifecycle | The window is created hidden, then `await loadRenderer(window)` completes before the `ready-to-show` listener is registered (`electron/main.ts:443-450`). Electron allows `ready-to-show` while the page is loading, so the event can be missed. | A valid launch can leave the only window hidden. One successful runtime launch does not eliminate this event-order race. |
| KD-ELEC-008 | **P2** | Camera / memory containment | The JPEG proxy's 8 MiB cap is checked only after `await response.arrayBuffer()` buffers the entire camera response (`electron/camera-frame-proxy.ts:126-151`). | A faulty or hostile allowed private-network camera can make the Electron main process allocate well beyond the advertised cap before rejection. |
| KD-ELEC-009 | **P2** | Crash / error behavior | Renderer errors have a useful local `ErrorBoundary`, diagnostics copy, and software Abort surface. The Electron host has no `crashReporter`, `render-process-gone`, `child-process-gone`, durable main-process log path, restart/recovery prompt, or packaged startup error dialog. A `createWindow` failure writes to the console then exits with code 1. | Main/renderer/GPU crashes and packaged startup failures have weak operator recovery and supportability, especially for a GUI launch with no console. |
| KD-ELEC-010 | **P2** | Desktop test coverage | Playwright CI starts Vite and drives Chromium; it does not launch a packaged Electron executable. Electron tests are predominantly pure source/policy tests. There is no exact installer/unpacked launch test for window visibility, custom protocol, OS integration, support links, permissions, single-instance behavior, or crash handling. | Packaging and Electron-only regressions can pass CI. KD-ELEC-005, KD-ELEC-006, and KD-ELEC-007 are examples of gaps source-unit tests did not close. |
| KD-ELEC-011 | **P2** | File lifecycle / deep links | Builder config has no `fileAssociations`; main has no first-launch argv, `second-instance`, `open-file`, or `open-url` routing. | Double-clicking a KerfDesk project in Explorer/Finder and OS “Open with” workflows do not open the project. This was previously documented and remains open on current main. |
| KD-ELEC-012 | **P3** | Branding / release quality | Shipped visible strings still say “LaserForge Desktop” in `src/platform/web/camera-bridge.ts:12`, `src/ui/camera/panel/CameraDiagnostics.tsx:91`, and `src/ui/state/camera-source-actions.ts:50`; the design-library notice says `KerfDesk/LaserForge` at `src/ui/library/design-library-owned-svg.ts:6`. The current data-continuity qualification checklist also says “LaserForge 2.0 desktop” (`WORKFLOW.md:4414`). No current `CurveDesk` occurrence was found. | Camera errors/diagnostics and one library notice expose the wrong product name; release documentation also retains a user/operator-facing old name. |
| KD-ELEC-013 | **P3** | Device UX consistency | Native serial discovery says `Select laser serial port` and the empty console message asks whether “the laser” is plugged in (`electron/main.ts:223,234`), although KerfDesk supports CNC/router and hybrid machines. | Native desktop wording contradicts the broader device model and is confusing for CNC users. |

### Stable-release hardening associated with KD-ELEC-002/003

These are lower-priority than the two blockers above but should be handled in the same release-quality review:

- Signature validation accepts any non-empty signer subject rather than an expected publisher allowlist.
- Stable lacks Preview's checksums, release manifest, SBOM, artifact attestations, and post-publication download verification.
- There has been no live stable workflow run; only the credential-free dry run is exercised.
- The R2 production feed needs a real staged install/update/rollback exercise before first stable publication.

## Historical or fixed items

| Item | Current evidence | Classification |
| --- | --- | --- |
| Product and release naming | `productName`, window title, installer/DMG names, shortcut, EULA/download surface, current release, and repository remote use **KerfDesk**. No `CurveDesk` occurrence was found. | **Fixed/current pass**, aside from KD-ELEC-012. |
| Preview release integrity | `v0.2.0-preview.13` came from successful run `29993070904`; its release is an immutable prerelease with Windows x64 and macOS x64/arm64 artifacts, checksums, manifest, and SBOM. Earlier failed/cancelled Preview attempts are superseded history. | **Historical failures; current pass.** |
| Preview updater trust | Packaged Preview metadata sets `kerfdeskUpdateChannelTrusted=false`; stable updater and Preview checker are mutually exclusive and fail closed. Preview validates successful workflow/tag/platform evidence and never performs silent install. | **Current pass.** |
| Renderer privilege boundary | No preload and no IPC are exposed. Renderer uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, a local `app://` scheme, restrictive CSP, blocked navigation, explicit permission handlers, and origin/device checks. | **Current pass.** |
| Legacy data continuity design | Before `ready`, app name is KerfDesk while `userData` and `sessionData` are deliberately pinned to `%APPDATA%\laserforge`; the Windows app ID is deliberately retained as `dev.laserforge.app`. | **Current design pass; real upgrade remains not qualified.** |
| Dependency advisories | `pnpm audit:deps` on the audited checkout reported no known vulnerabilities; the live dependency-audit workflow is also green. | **Current pass, point-in-time only.** |

## Professional Electron acceptance checklist

Legend: **PASS** = evidence supports current behavior; **PARTIAL** = substantial behavior exists but a material gap remains; **FAIL** = confirmed current defect; **NOT QUALIFIED** = requires supported OS/hardware/release credentials; **N/A** = deliberately outside current product scope.

### 1. Packaging, signing, and release

- [x] **PASS** — Windows x64 NSIS stable target and Windows x64/macOS x64/macOS arm64 Preview targets are explicit.
- [x] **PASS** — Artifact filenames, product name, shortcut, DMG title, EULA, legal resources, and current public release use KerfDesk.
- [ ] **FAIL** — provide real KerfDesk `.ico`/`.icns` assets and correct executable publisher/company metadata (KD-ELEC-006).
- [x] **PASS** — Preview produces hashes, manifest, SBOM, and attestations and verifies published assets.
- [ ] **FAIL** — require stable tag commit to be an ancestor of current `main` (KD-ELEC-002).
- [ ] **FAIL** — pin every production-release action to a reviewed full SHA (KD-ELEC-003).
- [ ] **PARTIAL** — verify the signer against an expected publisher identity, not merely a valid non-empty subject.
- [ ] **NOT QUALIFIED** — Windows production certificate, timestamping, SmartScreen reputation, and stable signature on a real release.
- [ ] **NOT QUALIFIED** — first live stable GitHub release and R2 feed publication.
- [ ] **NOT QUALIFIED** — unsigned/unnotarized macOS Preview warning and quarantine behavior on Intel and Apple Silicon.

### 2. Installation and update flow

- [x] **PASS** — assisted per-user NSIS install, directory selection, KerfDesk shortcut, EULA, and uninstall configuration exist.
- [x] **PASS** — stable feed URL is build-time fixed; untrusted metadata disables stable updater.
- [x] **PASS** — stable updater stages downloads and defers install to quit; it never calls `quitAndInstall`.
- [x] **PASS** — Preview check is bounded, validates workflow/release evidence, and is operator-initiated.
- [ ] **PARTIAL** — “install on quit” inherits the unresolved active-job shutdown problem (KD-ELEC-001).
- [ ] **NOT QUALIFIED** — clean install, custom path, uninstall, reinstall, downgrade, interrupted download, offline update failure, and rollback on real Windows.
- [ ] **NOT QUALIFIED** — Preview-to-Preview update on Windows and both Mac architectures.
- [ ] **NOT QUALIFIED** — stable R2 `latest.yml`/blockmap/update signature behavior.

### 3. Main, preload, renderer, and IPC boundary

- [x] **PASS** — no preload, `contextBridge`, `ipcMain`, or `ipcRenderer` surface exists; therefore there are no hidden IPC contracts to validate.
- [x] **PASS** — renderer lacks Node.js privilege and runs sandboxed with context isolation and web security.
- [x] **PASS** — desktop-only update endpoint is a narrowly handled exact `app://app` request.
- [ ] **RECOMMENDATION** — if native features later require IPC, define a versioned, schema-validated, least-privilege bridge rather than enabling generic IPC/Node access.

### 4. Security hardening

- [x] **PASS** — local custom protocol, CSP, navigation denial, window-open denial, permission handlers, strict trusted origins, and private-network camera policy are present.
- [x] **PASS** — renderer source maps are excluded from packaged files.
- [x] **PASS** — external navigation is not handed arbitrary URLs.
- [ ] **FAIL** — stream/cancel oversized camera responses before buffering them (KD-ELEC-008).
- [ ] **RECOMMENDATION** — configure Electron fuses at packaging time, especially disabling `RunAsNode`, and verify them from the packaged executable.
- [ ] **RECOMMENDATION** — add an allowlisted external-link broker that preserves the current deny-by-default policy while making intentional support links work.
- [ ] **RECOMMENDATION** — include ASAR/fuse/signature assertions in release verification.

### 5. Permissions, file access, and device access

- [x] **PASS** — serial permission checks, chooser, device grant policy, video-only media, File System Access, and screen wake lock are explicitly mediated.
- [x] **PASS** — camera bridge binds loopback and validates renderer origin plus private camera targets.
- [x] **PASS** — packaged file reads are rooted under the application bundle and path-traversal checked.
- [ ] **PARTIAL** — native serial language is laser-only despite CNC support (KD-ELEC-013).
- [ ] **NOT QUALIFIED** — allow/deny/retry/revocation for serial and camera on real Windows.
- [ ] **NOT QUALIFIED** — macOS camera and local-network TCC prompts, Settings recovery, and re-prompt behavior.
- [ ] **NOT QUALIFIED** — USB hot-plug, driver failure, busy port, multiple identical serial devices, and OS sleep/resume.

### 6. Lifecycle, windows, deep links, and OS integration

- [ ] **FAIL** — coordinate close/quit with active controller work (KD-ELEC-001).
- [ ] **FAIL** — enforce and test single-instance ownership (KD-ELEC-004).
- [ ] **FAIL** — register `ready-to-show` before loading or use a deterministic show strategy (KD-ELEC-007).
- [x] **PASS** — normal `window-all-closed` and macOS `activate` recreation handlers exist.
- [ ] **FAIL** — add project file association and first/second-instance file routing (KD-ELEC-011).
- [ ] **PARTIAL** — no persisted window size/position/maximized state; the app always opens at the hard-coded default.
- [ ] **PARTIAL** — no app protocol/deep-link handling, native application menu, or recent-project OS integration.
- [ ] **NOT QUALIFIED** — shutdown/logout, suspend/resume, monitor unplug, DPI changes, multiple displays, and OS theme changes.

### 7. Crash and error behavior

- [x] **PASS** — renderer `ErrorBoundary` provides a local diagnostic, retry, and a software Abort control when motion may be live.
- [x] **PASS** — global renderer error/unhandled-rejection handlers raise visible toasts.
- [ ] **FAIL** — add durable main/render/GPU crash logging and an operator recovery surface (KD-ELEC-009).
- [ ] **PARTIAL** — packaged renderer-load failure exits rather than leaving a zombie process, but gives a GUI user no actionable diagnostic.
- [ ] **NOT QUALIFIED** — controller behavior after renderer crash, main-process crash, GPU reset, power loss, cable loss, and OS kill.

### 8. Offline behavior and startup performance

- [x] **PASS** — renderer assets load from the packaged `app://app` bundle; normal editing does not require network availability.
- [x] **PASS** — updater/Preview-check network failures are non-fatal and must not block startup.
- [ ] **FAIL** — eliminate the hidden-window event race (KD-ELEC-007).
- [ ] **PARTIAL** — camera bridge startup failure is logged and camera functionality degrades, but there is no native consolidated diagnostic.
- [ ] **RECOMMENDATION** — establish cold/warm startup, first-content, interactive, memory, and large-project budgets in packaged Electron.
- [ ] **NOT QUALIFIED** — startup on minimum-spec hardware, slow disk, corrupt cache, unavailable network, and enterprise proxy.

### 9. Data paths, persistence, and migrations

- [x] **PASS** — compatibility path pinning happens before `ready`.
- [x] **PASS** — project migrations, autosave, IndexedDB recovery, recovery artifacts, provenance, libraries, and persistence limits have substantial automated coverage.
- [x] **PASS** — retaining legacy app ID/data directory is clearly documented as compatibility, not current branding.
- [ ] **PARTIAL** — two allowed app instances share the same stores (KD-ELEC-004).
- [ ] **RECOMMENDATION** — document and test backup/restore plus corruption recovery for all durable stores, including camera/device preferences outside the project file.
- [ ] **NOT QUALIFIED** — first KerfDesk run over an existing legacy-data installation and upgrade continuity across real signed builds.
- [ ] **NOT QUALIFIED** — uninstall choices and whether user data is intentionally retained.

### 10. Hardware and controller boundary

- [x] **PASS** — controller drivers, stream ownership, pause/resume, reconnect epochs, recovery artifacts, preflight, motion invariants, and simulator behavior have extensive tests.
- [x] **PASS** — renderer crash UI retains a software Abort route rather than presenting only a generic crash panel.
- [ ] **FAIL** — Electron close/quit is not an acknowledged hardware-state transition (KD-ELEC-001).
- [ ] **PARTIAL** — two Electron instances can independently approach the same device surface (KD-ELEC-004).
- [ ] **NOT QUALIFIED** — physical laser/spindle/off-state after close, crash, update, sleep, USB loss, and controller reset.
- [ ] **NOT QUALIFIED** — camera bridge with real USB/private-network/RTSP sources across supported OSes.
- [ ] **NOT QUALIFIED** — burn/cut quality, timing, thermal behavior, and physical output cannot be certified by app tests.

### 11. Build, test, and release CI

- [x] **PASS** — audited-head CI run `30182447836`, browser-smoke run `30182447846`, and Pages run `30183162746` succeeded.
- [x] **PASS** — release gate covers typecheck, lint, Electron lint, format, ADR/license policy, Vitest, legal closure, web/Electron builds, exports, and size policy.
- [x] **PASS** — dependency audit is scheduled and was also clean locally at audit time.
- [x] **PASS** — Preview action dependencies are full-SHA pinned and release assets are post-publication checked.
- [ ] **FAIL** — stable action dependencies are mutable and stable tag ancestry is not verified (KD-ELEC-002/003).
- [ ] **FAIL** — add packaged Electron smoke and OS-integration tests (KD-ELEC-010).
- [ ] **PARTIAL** — browser smoke is observability-only on main, not a required pull-request gate.
- [ ] **NOT QUALIFIED** — live stable production environment, secrets, certificate, R2 credentials, and release rollback.

### 12. Platform-specific behavior

- [x] **PASS** — current scope is explicit: Windows x64 stable/Preview, macOS 12+ x64/arm64 Preview, Linux web only.
- [x] **PASS** — Mac Preview has camera/local-network usage descriptions and explicit minimum OS.
- [x] **PASS** — Linux desktop absence is deliberate and should not be described as a defect.
- [ ] **NOT QUALIFIED** — Windows 10/11 install, display scaling, serial chooser, shortcut, uninstall, and update.
- [ ] **NOT QUALIFIED** — macOS 12 floor plus current macOS on Intel/Apple Silicon, Gatekeeper, TCC, private-network privacy, drag-to-Applications, update/reinstall.
- [ ] **NOT QUALIFIED** — ARM Windows, 32-bit Windows, Linux desktop, and non-supported macOS versions are outside current claims.

### 13. Accessibility and UX consistency

- [x] **PASS** — dialogs, keyboard shortcuts, tooltip/help contracts, focus utilities, live regions, and multiple accessibility-focused tests exist.
- [ ] **FAIL** — make desktop support actions work without weakening navigation policy (KD-ELEC-005).
- [ ] **FAIL** — remove visible LaserForge naming and use KerfDesk consistently (KD-ELEC-012).
- [ ] **PARTIAL** — native serial wording assumes a laser (KD-ELEC-013).
- [ ] **RECOMMENDATION** — add automated accessibility scanning of the primary shell and packaged Electron.
- [ ] **NOT QUALIFIED** — Windows Narrator, macOS VoiceOver, keyboard-only full workflow, 200% scaling, high contrast, reduced motion, and color-vision review.

### 14. Branding and release identity

- [x] **PASS** — user-facing current name is KerfDesk; no `CurveDesk` source occurrence was found.
- [x] **PASS** — current release tag title and every public artifact name use KerfDesk.
- [x] **PASS** — legacy `dev.laserforge.app`, `%APPDATA%\laserforge`, internal package/format keys, and historical documentation are compatibility/context identifiers.
- [ ] **FAIL** — replace the shipped visible old-name strings listed in KD-ELEC-012.
- [ ] **FAIL** — provide branded app/installer icons (KD-ELEC-006).
- [ ] **RECOMMENDATION** — maintain a CI branding allowlist: intentional legacy identifiers may remain, but new visible “LaserForge” or any “CurveDesk” string should be reviewed.

## Build, runtime, and release evidence

### Local checks

| Check | Result |
| --- | --- |
| `pnpm audit:deps` | **PASS** — no known vulnerabilities. |
| First `pnpm release:check` | **ENVIRONMENTAL FAIL** after 7,317 passing tests: 26 suites could not load `lucide-static/*.svg?raw` because this worktree's `node_modules` was a junction into `C:\Users\Asus\LaserForge-2.0`, outside Vite's allowed root. This is not a source assertion failure. |
| Dependency layout correction | The audit worktree received its own frozen-lockfile dependency layout; no dependency version or production source changed. |
| Clean-layout `pnpm release:check` rerun | **MIXED / NOT A CLEAN EXACT-HEAD RUN** — 1,246 files/7,415 tests passed and 14 files/22 tests skipped. Installer compression caused a V-carve timeout and Vitest worker RPC timeout. More importantly, another task edited `framed-run.ts`, its test, and related product/test files at 11:55 while the suite was running, producing the framed-run mismatch. Both failing files passed after concurrent work ended (2 files, 13 tests; V-carve 102 ms), but that isolated result includes the other task's uncommitted changes and is not exact-main proof. The entire suite was not run a third time. Exact-head cloud CI is the authoritative complete gate and is green. |
| Fresh Windows Preview package | **PASS** — electron-builder 26.15.3 produced `KerfDesk-0.0.0-audit.261695a-windows-x64-setup.exe` (100,302,961 bytes; SHA-256 `F8FC9332CEFB48820504CA30F5167CA39DFAFABC6A6DC1C1D76BA41CB0CA5A8E`). Preview metadata verification and packaged legal-file checks passed. Installer and executable were correctly unsigned. |
| Unpacked runtime launch | **PASS, WITH DATA-PATH CAVEAT** — packaged `KerfDesk.exe` reached a visible first window in 935 ms, loaded `app://app/index.html`, reported title/app name `KerfDesk`, had one window, and removed the splash by 2,726 ms. No installer or hardware was used. |
| Remaining release gates | **PASS BY COMPONENT** — typecheck, lint, Electron lint, format, ADR numbering, license closure, release-integrity tests (8/8), web build, Electron-main build, hard file-size policy, soft-size report, and public-export ratchet. Because the shared worktree changed mid-audit, this is not presented as one immutable serial run. |

The first run's failure is important process evidence: current CI is green, but ad hoc worktrees that borrow another checkout's `node_modules` can produce false negatives. The release result below must come from a dependency tree physically rooted in the audited worktree.

The second run exposed a separate shared-worktree hazard. The worktree was clean at audit start, but another task created an unrelated audit and then modified four tracked source/test files plus two new tests while the suite was active. Those changes are user-owned, were not touched or reverted, and are excluded from this audit's source findings. Timestamp ordering preserves the package evidence: the web bundle completed at 11:54:46 and Electron main at 11:55:03; the first product edit arrived at 11:55:18. The installer therefore packaged the exact-main compiled application even though the source worktree became dirty during later compression/testing.

The runtime launch attempted to redirect `APPDATA`/`LOCALAPPDATA` to a disposable audit directory. Electron's Windows `appData` lookup plus KerfDesk's explicit compatibility pin still resolved `userData` and `sessionData` to the real `C:\Users\Asus\AppData\Roaming\laserforge` path. The launch therefore read/touched the existing Chromium profile/session area; no project was opened, no controller/camera was connected, and no further packaged launches were performed. A truly isolated packaged-runtime test needs a supported test-only data-root mechanism or a disposable Windows account/VM.

The fresh package also supplied direct branding evidence:

- `FileDescription`, `ProductName`, `InternalName`, title, and app name were `KerfDesk`.
- `FileVersion` and `app.getVersion()` were `0.0.0-audit.261695a`.
- `CompanyName` was incorrectly inherited as `GitHub, Inc.`.
- Builder logged `default Electron icon is used — application icon is not set`.
- The compiled renderer contained three `LaserForge Desktop` occurrences and one `KerfDesk/LaserForge` occurrence; no `CurveDesk` occurrence was found.

### Live GitHub/release evidence

- Audited-head CI: [run 30182447836](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30182447836), success.
- Audited-head browser smoke: [run 30182447846](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30182447846), success.
- Audited-head Pages deployment: [run 30183162746](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30183162746), success.
- Finish-time `origin/main` (`de36b867`) browser smoke: [run 30186962465](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30186962465), success. Its full CI [run 30186962467](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30186962467) was still running when this audit closed.
- Current public desktop Preview: [KerfDesk 0.2.0-preview.13](https://github.com/cisgz3a-hub/KerfDesk/releases/tag/v0.2.0-preview.13), published 2026-07-23.
- Preview workflow: [run 29993070904](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/29993070904), success at commit `d22e75e8f04e593ba8814b3160536784790da3c4`.
- Stable production workflow: no live run found. The credential-free dry-run workflow has succeeded, which validates packaging logic but not certificate/R2/release behavior.

## Branding audit: allowed legacy identity vs defects

### Allowed compatibility/internal references

- Windows `appId: dev.laserforge.app` retains installer/update identity.
- `%APPDATA%\laserforge` retains existing user data and Chromium session state.
- Historical ADR text, migration tests, package-format keys, local-storage keys, internal log prefixes, and repository history can retain the legacy term where changing it would break compatibility or falsify history.
- The on-disk source directory name is not a shipped brand surface.

### Improper current visible references

1. Camera bridge availability message: “LaserForge Desktop”.
2. Camera Diagnostics repair hint: “update LaserForge Desktop”.
3. Local camera bridge error: “LaserForge Desktop starts it automatically”.
4. Design-library attribution: “KerfDesk/LaserForge”.
5. Current real-install continuity checklist: “LaserForge 2.0 desktop”.

No current `CurveDesk` string was found. It should be treated as a prior reporting mistake, not as an approved product alias.

## Source-backed strengths

- The Electron renderer has no Node privilege, preload bridge, or IPC attack surface.
- The custom protocol and CSP avoid remote-content execution as an application shell.
- Navigation, new windows, permission requests, serial-device grants, media capture, File System Access, wake lock, and private-network camera targets are explicitly constrained.
- Preview and stable update mechanisms are separated and fail closed when package metadata is untrusted.
- Preview release governance is unusually thorough for a prerelease: exact action SHAs, main ancestry, platform matrix, metadata verification, unsigned-state verification, legal closure, manifest, checksums, SBOM, attestations, immutable release, and downloaded-asset verification.
- Renderer-level failure behavior is operator-aware and retains a software Abort route.
- Project/data migrations and controller/recovery behavior have deep automated coverage.

## Authoritative baseline references

- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron `BrowserWindow` lifecycle and `ready-to-show`](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron `app` lifecycle and single-instance APIs](https://www.electronjs.org/docs/latest/api/app)
- [electron-builder application icons](https://www.electron.build/docs/features/icons-and-images/)
- [electron-builder file associations](https://www.electron.build/docs/api/electron-builder.interface.fileassociation/)
- [GitHub Actions secure use and immutable action references](https://docs.github.com/en/actions/reference/security/secure-use)

## Qualification limits

This audit does **not** certify:

- production signing, SmartScreen reputation, Gatekeeper/notarization, or installer reputation;
- Windows install/uninstall/upgrade/rollback on clean machines;
- Mac Preview behavior on Intel and Apple Silicon or camera/local-network TCC flows;
- serial/camera permissions and recovery on real supported operating systems;
- active-controller behavior after window close, crash, suspend, logout, OS kill, cable loss, or update install;
- legacy-data continuity across real installed versions;
- physical burn/cut quality, spindle/laser state, thermal outcome, or controller fail-safe behavior;
- screen-reader, high-contrast, large-scale, or keyboard-only end-to-end accessibility.

These are not test failures. They are remaining release-qualification work and must stay labeled **CLAIMED/NOT QUALIFIED** until exercised on the relevant OS and hardware.

## Recommended remediation order

1. Decide and document the required hardware-safe Electron close/quit contract, then implement an ordered controller-stop/acknowledgement flow without weakening existing controller safety semantics.
2. Require one app instance and explicitly route second launches/files to the owning process.
3. Block stable publication unless the tag commit is in current `main`, and full-SHA pin every production action.
4. Add branded Windows/macOS icons and a packaged-Electron smoke that checks visible startup, custom protocol, title, icon/metadata, link behavior, and single-instance ownership.
5. Route intentional support URLs through a narrow allowlisted main-process external-open mechanism.
6. Register `ready-to-show` before navigation or use a deterministic first-paint strategy.
7. Stream-limit camera response bodies and add durable main/render/GPU crash diagnostics.
8. Add project-file association/open routing and then complete real Windows/macOS installer, updater, permission, accessibility, and hardware qualification.
9. Remove the visible LaserForge strings while retaining only documented compatibility identifiers.

## Completion status

The read-only audit is complete. Fresh exact-main Windows packaging and unpacked runtime evidence are complete; real installation was deliberately not performed. The local all-suite evidence is transparently labeled mixed because the checkout changed during the run; exact-head GitHub CI supplies the clean complete-gate evidence. Remediation is intentionally out of scope. No production code or safety gate was modified by this audit.
