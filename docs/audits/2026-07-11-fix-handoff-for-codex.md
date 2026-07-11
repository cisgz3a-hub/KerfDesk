# Fix handoff for Codex re-audit — PR #50

**Branch:** `claude/multi-sector-audit-3447b9` → `main` · **HEAD:** `3bb6d3b0` · **PR:** #50
**Gate at HEAD:** `pnpm typecheck` ✓ · `pnpm lint` ✓ · `pnpm exec prettier --check .` exit 0 ✓ · `pnpm test` **4287 passed / 17 skipped / 0 failed**.

## What this is
The fixes made in response to (a) Codex's first audit of this branch [4 P1 + 3 P2 + merge blockers, verified against `461f0d96`] and (b) my own self-audit, plus three items promoted from "report-only" to fixes this session. This is a map for re-auditing them. **Nothing here is perceptually or hardware-verified** — see the last section. Please try to break each fix, not just confirm it.

## How to verify
- Commits (newest first): `git log --oneline 461f0d96~1..HEAD`
- Everything below cites a symbol name + file (line numbers drift — grep the symbol).
- Full gate: `pnpm typecheck && pnpm lint && pnpm exec prettier --check . && pnpm test`
- Reference for the original findings: `docs/audits/2026-07-10-consolidated-audit-v2.md`, `docs/audits/2026-07-10-implementation-plan.md`, and Codex's own `docs/audits/2026-07-11-consolidated-audit-v2-fix-verification.md`.

---

## Group A — promoted from report-only this session (audit these hardest)

### A1 · ELE-02 — camera bridge origin + loopback proxy hardening (S03-001)
- **Commits:** `c1aec28a` (fix + ADR-133), `3bb6d3b0` (integration-test re-level).
- **Defect (Codex-confirmed):** `isTrustedHostedAppOrigin` trusted `*.laserforge-2fj.pages.dev` — every Cloudflare Pages preview of any branch/PR could drive the loopback bridge's `/discover`, `/frame.jpg`, `/probe`, `/stream.mjpg`. Separately, `cameraFrameUrlPolicy` refused only the bridge's own port, so `http://127.0.0.1:<other>` was a permitted proxy target → localhost port/host oracle.
- **Fix:**
  - `electron/rtsp-camera-bridge.ts` — `TRUSTED_HOSTED_APP_HOSTNAMES` is now an exact `Set(['kerfdesk.com','laserforge-2fj.pages.dev'])`; the wildcard is gone. The loopback-dev-origin allowance (`isLoopbackDevOrigin`, http localhost/127.0.0.1 any port) is untouched.
  - `electron/camera-frame-proxy-policy.ts` — new `isLoopbackHost(url)` (localhost / ::1 / 127.0.0.0/8, bracket-stripped); `cameraFrameUrlPolicy` refuses **all** loopback, keeping `targetsBridgeItself` only to pick the sharper "cannot proxy itself" message.
- **Tests:** `rtsp-camera-bridge.test.ts` (preview subdomain → `null`), `camera-frame-proxy-policy.test.ts` (loopback on any port + `[::1]` → `invalid`), `camera-frame-proxy.test.ts` (full path refuses a loopback camera but still sets CORS; upstream never hit).
- **Audit hints — please probe:**
  1. Bypass the exact-host set: does an origin like `https://kerfdesk.com.evil.com`, `https://kerfdesk.com:443` (explicit port), uppercase host, trailing dot (`kerfdesk.com.`), or userinfo (`https://kerfdesk.com@evil`) slip through `new URL(origin).hostname`? I believe `hostname` normalises these, but confirm.
  2. Loopback classifier: is `0.0.0.0`, `127.1` (short form), `0x7f.0.0.1`, `[::ffff:127.0.0.1]` (v4-mapped), or `[::1%eth0]` (zone id) treated as loopback? My check is `host==='localhost' || host==='::1' || host.startsWith('127.')` after bracket-strip — v4-mapped-in-v6 and `0.0.0.0` are **not** caught. Is that a hole given the private-network egress guard also runs?
  3. The re-level (`3bb6d3b0`): I export `serveHttpFrame` and test the JPEG/content-type/502 behavior against a loopback mock *below* the policy. Is that a legitimate coverage substitute, or did I lose a real end-to-end assertion?

### A2 · PST-02 — checkpoint stores output scope + job placement (crash-resume)
- **Commit:** `486473f4` (fix + ADR-118 amendment, checkpoint schema v1→v2).
- **Defect (Codex-confirmed, major):** `runCheckpointResumeFlow` recompiles via `prepareResume()`, which reads `currentOutputScope(app)` + `app.jobPlacement` from **live** state. A crash resets those to defaults, so a run that used "cut selected graphics" or a non-default placement recompiled to different bytes → `fingerprintsEqual` false → false "it was edited since" refusal → a selective multi-hour burn could not resume.
- **Fix:**
  - `src/core/recovery/job-checkpoint.ts` — `JobCheckpoint` gains `outputScope: OutputScope` + `jobPlacement: JobPlacementSettings`; `JOB_CHECKPOINT_SCHEMA_VERSION` bumped 1→2; `createJobCheckpoint` takes both; `validatedCheckpointBody` adds strict `parseOutputScope` / `parseJobPlacement` arms (start-mode + anchor validated against the canonical lists; ids validated as `string[]`).
  - `src/ui/laser/start-job-flow.ts` — write site captures `currentOutputScope(app)` + `jobPlacement`; `prepareResume(overrides?)` re-applies the checkpoint's stored values; `runCheckpointResumeFlow` passes them; `runStartFromLineFlow` (manual) still uses live state.
- **Tests:** core round-trips the new fields + discards a v1 (fieldless) payload + strict-parse corpus; a **flow-level** test (`start-job-flow.test.ts`, "resumes after a crash reset the output scope") proves a selective run resumes after its scope resets. I confirmed that test is non-vacuous by temporarily removing the override and watching it reproduce the exact false refusal, then restored.
- **Audit hints — please probe:**
  1. Is `outputScope.selectedObjectIds` guaranteed to survive autosave with stable ids? If a restored object's id differs, the filtered scene changes and the fingerprint still won't match — is my "ids are serialized + validated" assumption correct across all import paths?
  2. Schema bump: a v1 slot now reads `null` and is discarded silently. Is dropping an in-flight v1 checkpoint acceptable, or should there be a migration/notice?
  3. Does any OTHER compile input (device profile, material library, layer defaults) also fail to survive a crash and independently break the fingerprint? PST-02 only closes scope + placement.

### A3 · Camera overlay resolution rescale (Codex P2)
- **Commit:** `c70f4b87`.
- **Defect:** `WorkspaceCameraOverlay` / `CameraOverlay` applied the persisted homography directly, while the Trace path rescales it (`scaleAlignmentHomographyToFrame`). When the live stream / captured still runs at a resolution ≠ the calibration frame, the warped overlay is off by the resolution ratio.
- **Fix:** `CameraOverlay.tsx` takes the `CameraAlignment` and rescales by the live video's intrinsic size on `loadedmetadata`; `WorkspaceCameraOverlay.tsx` rescales the still path by the still's own size. Same pure helper Trace uses.
- **Tests:** `CameraOverlay.test.tsx` drives a 640×360 frame-load against a 1280×720 calibration and asserts the `matrix3d` transform changes; the scaling math itself is covered in `alignment-resolution.test.ts`.
- **NOT verified:** the visual result. Rule 4 forbids me driving the live overlay (it shares the maintainer's real scene). The scaling is unit-tested and identical to the verified Trace path, but pixel alignment on a real camera is unconfirmed. **Known residual:** independent X/Y scaling still assumes an unchanged field of view; an aspect-ratio / sensor-crop change should force recalibration — that guard is a shared follow-up (affects Trace equally) and a maintainer decision.

---

## Group B — Codex P1/P2 fix pass (verify the fixes are correct AND complete)

### B1 · P1 — tool-change controls unlock before the machine reaches position
- **Commits:** `c9bb10a2`, refactor `30f3fa86`.
- **Fix:** `toolChangeReady(state)` in `laser-store-helpers.ts` = `streamer.inFlight.length === 0 && state.toolChangeIdleSeen`. `toolChangeIdleSeen` is set only when a **fresh** Idle is observed while holding at a tool change with the pre-M0 tail drained (`freshToolChangeIdlePatch` in `laser-status-line.ts`), and reset on tool-change entry (`laser-stream-ack.ts`). The setup gate + Continue use `toolChangeReady`, **not** a stale `statusReport.state === 'Idle'`.
- **Audit hints:** confirm status polling really stays active during `tool-change` (so a fresh Idle can arrive) — `isActiveJob` includes `tool-change` and `connection-actions` keeps polling. Confirm Start stays strictly blocked (it routes through `activeJobCommandBlockMessage`, which does NOT consult `toolChangeReady`). Race: can `toolChangeIdleSeen` latch from an Idle that predates the retract actually finishing? It requires `inFlight.length === 0` in the same status frame — check whether in-flight can be momentarily empty mid-retract.

### B2 · P1 — tool-change hold missing from lifecycle handlers
- **Commit:** `914f3248`. Added `'tool-change'` to the reboot / alarm / stream-error / machineBusy status lists (`laser-line-handler.ts`, `laser-status-line.ts`, `laser-error-line.ts`, `use-app-commands.ts`). **Hint:** the finding warned these use `.includes()` not exhaustive switches, so TS won't flag a missed site — please grep every `streamer.status` / `StreamerStatus` consumer and confirm none still omits `tool-change`.

### B3 · P1 — CNC work-zero advisory ignored Z
- **Commit:** `53b3af9e`. New session-scoped `workZZeroKnown`; `cncWorkZeroAdvisory(project, workZZeroKnown)` keys on Z0, not the XY origin. Set by Zero-Z + probe-'ok'; invalidated at 6 choke points (reconnect; reset/alarm/reboot via `originUnknownAfterControllerReset`; soft-reset; homing; release-motors/clear-origin; tool-change entry). **Hint:** verify Set-Origin `G92 X0 Y0` (XY only) no longer suppresses the Z warning, and that all 6 invalidations actually fire — especially whether any path sets a work Z0 without setting `workZZeroKnown`, or clears XY origin without clearing Z0.

### B4 · P1 — F300 resume on ramp/relief cuts
- **Commit:** `34b33663`. `resume-program.ts` `recordPlungeFeed(state, prevZ)` records the plunge feed from **any G1 Z-lowering move** (ramp with X/Y/Z/F, not just a pure-Z plunge), tracks modal `motionMode` + previous Z, and never records from a `G0` or an upward/retract move. **Hint:** adversarial G-code — a G1 that lowers Z with no explicit F (inherits modal feed); a relief pass that lowers Z in several steps; a file that sets F on a travel line before the first plunge. Does the recovered feed match what the original run actually used at the resume line?

### B5 · P2 — duplicate Console row ids
- **Commit:** `b8c772c6`. System-notice transcript ids now come from the single shared `refs.nextTranscriptId` (was `lastId+1`, colliding with the next controller line → duplicate React keys). The wake-lock hook (no `refs`) routes through a new `pushSystemNotice` store action. **Hint:** confirm no remaining id source other than the shared counter; check the wake-lock path increments the same counter.

### B6 · P2 — no-go-zone blocked a Z-only jog
- **Commit:** `a12ef818`. `assertJogClearsNoGoZones` returns early when `dx === 0 && dy === 0` (a Z-only jog has no XY motion to test). **Hint:** confirm a diagonal jog that grazes a zone is still blocked, and that a zero-length XY + nonzero Z is the only case skipped.

### B7 · merge blockers
- **Prettier** (`e82c8dae`): formatted the 10 remaining pre-existing dirty files; `prettier --check .` now exit 0. These were not my continuation's files.
- **ADR-127 collision:** already resolved in-tree before this session — `DECISIONS.md` has a single `## ADR-127` (main's rotary engine); my branch's ADRs are 128–131 (+132 this session). No duplicate headers; no stale ADR-127/128 code refs. Codex's ADR-127 finding was against an older snapshot.

---

## Group C — self-audit fixes (my own adversarial pass, pre-Codex)

- **F1 `be75add4`** [major] — `tryVectorOp<T>()` boundary helper wraps every clipper2-ts call in `vector-path-tools.ts` / `-booleans.ts` / `dogbone.ts`; an internal clipper throw on pathological/NaN geometry now returns `err({kind:'operation-failed'})` instead of escaping the Zustand `set()` uncaught (restores the catch-all ARC-02 removed). Test mocks clipper to throw. **Hint:** confirm every clipper entry point is wrapped (union/difference/intersect/xor/inflate) and no caller re-throws.
- **F10 `dda88f31`** — `isWellFormedIpv6` structural validation before the first-hextet classification in `private-network-host-policy.ts` (rejects `fdff:`, `fc00:::::`, 9-group, 5-digit-group, etc., which previously slipped as "private-prefixed garbage"). **Hint:** fuzz IPv6 literals; ensure no public address is ever accepted and no malformed literal throws.
- **F4 `b8868eec`** — Smoothieware settle uses `M400` (`SMOOTHIE_CMD_SETTLE`), not `G4 P0.01` (on Smoothie `G4 P` is milliseconds → an instant-ack no-op). **NOT hardware-verified** which real boards need this.
- **F6 `a25ea752`** — `scripts/check-soft-line-limit.mjs` wraps its fs walk in try/catch so it can never fail `release:check` (it is `&&`-chained last), and threads template-literal state across lines so a `//` inside a template string isn't miscounted as a comment.
- **DEV-06 `461f0d96` (+ `71683218`)** — the laser speed advisory compares the **emitted** feed `min(topSpeed, device.maxFeed)` against the controller's reported `$110/$111`, not the raw layer speed (which falsely blamed the controller when the profile clamp fired first). `71683218` added the bed-vs-`$130/$131` travel cross-check. **Note:** my original DEV-06 commit message claimed "test-first" but the source predated the test — flagged honestly in the self-audit; history can't be rewritten (already pushed).

---

## Verified already-done / deferred (not defects)

- **DEV-06 (ticket) — fully implemented.** `detectLaserMachineLimitWarnings` (bed-vs-travel + speed-vs-max) is wired into the laser branch of `detectMachineJobWarnings`; 7 tests. The offline residual (no controller connected ⇒ no reported limits) is not a code gap.
- **DEV-02 (saved-machines list + picker) — deferred by the maintainer to its own PR.** ~500-line/~8-file feature (localStorage persistence + add/apply/delete + boot-restore + a Machine-Setup "Save as my machine" button + a Laser-rail device picker, validated via `io/machine-profile`, own ADR). Features stay separate from fixes, and its UI can't be perceptually verified from here. Plan: `docs/audits/2026-07-10-implementation-plan.md` DEV-02.
- **Still genuinely gated (report-only):** unsigned desktop builds (needs a signing cert), `.lbdev` synthetic fixtures (needs hardware captures), controller-kind ↔ streaming-mode compatibility (a design decision).

## What is NOT verified (please treat as open risk)
- **No hardware.** Every CNC tool-change / resume / work-Z fix (B1–B4, and PST-02's resume) is unit/simulator-proven only. None has run on a real controller cutting real stock. The suite asserts structure + determinism, never fidelity.
- **No perceptual check** on the camera overlay (A3) — Rule 4 forbids me driving the live app.
- **Simulator blind spot:** the GRBL/Smoothie simulators only ever emit the formats the tests feed them; F4 (Smoothie M400) and B4 (real plunge feeds) are the kind of thing a real board could still contradict.

## Suggested adversarial focus for the re-audit
1. **B1 tool-change readiness** — the race between `inFlight` draining and the "fresh Idle" latch is the subtlest safety change; try to construct a status sequence where setup unlocks while the retract is still moving.
2. **B4 resume feed recovery** — feed inheritance across modal state on ramp/relief geometry.
3. **A1 loopback/origin classifiers** — the bypass cases listed under A1 (v4-mapped IPv6, `0.0.0.0`, host-set edge cases).
4. **A2 fingerprint completeness** — any other compile input that a crash resets and that would independently break the resume fingerprint.
