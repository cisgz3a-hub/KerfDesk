# KerfDesk consolidated full-sweep audit v2 — fix verification

**Audit date:** 2026-07-11  
**Source register:** `docs/audits/2026-07-10-consolidated-audit-v2.md`  
**Verified checkout:** `.claude/worktrees/admiring-hamilton-666624`  
**Verified HEAD:** `c70f4b87a19f9d960d3790d12c8b8ffb9e9983f8` (`claude/multi-sector-audit-3447b9`)  
**Method:** current source and tests first, commit history second. Uncommitted changes were included when present. During this audit Claude committed several product changes and then began another uncommitted camera-bridge patch; the final dirty state is recorded below rather than treated as shipped truth.

## Executive verdict

No: the v2 audit is **not fully fixed**.

The authoritative main register currently scores:

| Status | Count | Meaning |
|---|---:|---|
| Fixed | 13 | The reported mechanism is closed in current source and has meaningful automated coverage. |
| Partial | 7 | A useful fix landed, but the original safety/workflow contract is not fully closed. |
| Open | 9 | The reported mechanism remains materially reproducible. |
| **Total** | **29** | Main Tier 0, Tier 1, and named Tier 2 items. |

The appendix contains 44 sector IDs, many duplicating the main register. Its literal ID score is **17 fixed, 4 partial, 22 open, and 1 refuted/superseded**. Do not add the appendix counts to the main counts; that would double-count the same defects.

The product is substantially safer than the v2 snapshot, but the v2 register is not closed. The largest remaining blockers are unsigned desktop updates, the cross-origin loopback camera bridge, incomplete crash-resume identity, the absent app-level machine registry, controller/profile coupling gaps, and camera raw/rectified-basis mismatch.

## Post-fix claim verification — HEAD c70f4b87

Claude's later statement **“all Codex-audit defects fixed” is not supported by the v2 register**. The seven items relabeled “report-only” are all explicit v2 findings:

| Claimed report-only item | V2 source | Current status |
|---|---|---|
| Unsigned desktop builds | P1-j / A.2.1 | **Open** — requiring a certificate or release-infrastructure decision explains the blocker; it does not close the update-integrity defect. |
| Machine registry | P1-m / A.4.2 | **Open** — v2 explicitly records the missing app-level machine list as a major workflow/safety finding. |
| Controller-kind ↔ streaming-mode compatibility | named Tier 2 / A.3.3 | **Open** — profile application can still retain a mode unsafe for the selected controller. |
| Synthetic `.lbdev` fixtures | named Tier 2 / A.4.5 | **Open** — needing real exports is the finding itself. |
| Crash-recovery scope preservation | P1-i / A.1.3 | **Open** — v2 already scopes the minimum data and refusal-message correction. |
| Camera-bridge origins | P1-k / A.2.3 | **Open** — private-host URL filtering constrains destinations but does not prevent an allowed malicious/compromised preview origin from driving private-network probes. |
| Partial laser live-limit checking | named Tier 2 / A.4.6 | **Partial** — DEV-06 is useful but does not make the broader finding fixed. |

The new Codex follow-up commits do close real defects: fresh-Idle/drained-ack gating for tool-change setup and Continue, tool-change lifecycle handling, separate Z-zero knowledge, ramp/relief resume-feed recovery, shared Console IDs, Z-only jog behavior, and the Prettier blocker. The camera resolution subdefect is also fixed: both live and still overlays now scale the alignment homography to the actual frame dimensions.

However, the camera overlay is **still not equivalent to Trace for rectified alignments**. `runAutoAlign()` can save `basis: 'rectified'` after de-fisheying a calibrated frame, and `trace-from-camera.ts` honors that basis by rectifying raw captures before applying the homography. `CameraOverlay.tsx` and `WorkspaceCameraOverlay.tsx` only rescale resolution; they still apply a rectified-basis homography directly to raw video/still pixels and neither reads the camera calibration. Their new tests use only `basis: 'raw'`. Resolution mismatch is closed; raw-vs-rectified basis mismatch remains open and is not perceptually verified.

## Main register — authoritative status

| ID | Status | Verification |
|---|---|---|
| C1 CNC M0 tool change cannot be completed in-app | **Partial** | Sender-side M0 interception, a tool-change state, setup-motion exception, UI instructions, and Continue now exist. HEAD c70 includes the later fresh-Idle plus drained-ack gate, closing the unsafe early-unlock defect. The remaining v2 acceptance gap is tool identity: comments are stripped and the hold/prompt does not name the expected next bit. |
| C2 File → New resets the machine profile | **Fixed** | `newProject()` preserves the active device profile; regression coverage landed with DEV-01. |
| P1-a Duplicate Connect uses the wrong controller behavior | **Fixed** | Menu Connect now uses the active profile's controller kind and baud. |
| P1-b CNC resume hard-codes F300 | **Fixed** | Resume derives the re-entry feed from the interrupted program. Current generated CNC paths no longer use the fixed F300 plunge. |
| P1-c Tiled export bypasses readiness and provenance | **Partial** | Controller readiness now runs once before any tile is written. Tile output still bypasses the metadata/provenance header used by single-file G-code export. |
| P1-d Complexity/output budgets are not shared | **Fixed** | `prepareOutput()` is now the shared pre-emit budget/compile path for Preview, Save, Start, Estimate, and Frame consumers. |
| P1-e New CNC layer defaults through-cut with tabs off | **Partial** | A prominent advisory was added, but the unsafe starter values remain valid and preflight still permits them after warning. |
| P1-f NaN/non-finite coordinate words evade final scanning | **Fixed** | Non-finite project numerics are rejected at deserialization and non-finite emitted motion is rejected by preflight, with corrupt-fixture tests. |
| P1-g Camera alignment is not bound to displayed frame geometry | **Partial** | Letterbox click mapping and saved-alignment resolution rescaling were fixed. The workspace overlay still applies an alignment homography directly to raw still/video pixels without honoring `alignment.basis` or rectifying a `rectified` alignment source first. |
| P1-h Restored autosave produces stale restore prompts | **Fixed** | Restores are re-homed to the current session slot and the dead slot is cleared, with cross-session tests. |
| P1-i Resume fingerprint loses scope/placement | **Open** | `JobCheckpoint` still stores fingerprint/counts/machine kind only. Output scope, selection identity, and placement are not persisted, so a crash can still produce the misleading edited-project refusal. |
| P1-j Electron updater is unsigned/unverified | **Open** | The update feed is pinned, but no signing identity or signature verification is configured. Project documentation now honestly says the executable is unsigned; that is documentation, not mitigation. |
| P1-k Camera bridge origin allow-list trusts hosted/previews | **Open** | `cameraBridgeCorsOrigin()` still allows `kerfdesk.com`, the production Pages host, and every matching preview subdomain to drive the loopback bridge. |
| P1-l Overrides and settle dwell bypass drivers | **Fixed** | Overrides are capability-gated and post-job settle uses `driver.commands.settleDwell`. |
| P1-m No app-level machine list; connected apply keeps stale values | **Open** | There is still no app-level profile registry. `profileWithControllerFacts()` still promotes current profile fields whenever a controller read timestamp exists; the wizard path can preserve stale old-machine numbers after the detection patch is cleared. |

### Tier 2 register

| Finding | Status | Verification |
|---|---|---|
| M-08 arc-extrema bed bounds | **Fixed** | G2/G3 extrema are now included in bed-bound checks. Arc-vs-no-go-zone interpolation remains a separate unclosed edge, not a failure of this specific fix. |
| M-12 unmounted LaserLog warnings | **Fixed** | Operator diagnostics are routed into the mounted Console transcript. |
| M-13 Frame verification state is invisible | **Open** | Start gates consume the state, but there is still no clear proactive verified/stale indicator in the normal job UI. |
| M-14 PWA reload during an incomplete/disconnected job | **Partial** | The update prompt is gated off the Electron shell. The web/PWA disconnected incomplete-job reload path remains possible. |
| M-18 synchronous autosave and retry behavior | **Open** | Autosave remains synchronous localStorage work and failure retry behavior remains a recurring degradation path. |
| M-25 mutable LiveRefs and broad subscriptions | **Open** | The architectural ownership exception remains; no ADR or containment refactor closes it. |
| M-30 planner ETA exit velocity | **Fixed** | Junction velocity is clamped to both adjacent blocks' target speeds. |
| +Infinity normalizer gap | **Fixed** | Machine and CNC-layer values now require finite values, with `1e999` tests. |
| `streamingMode` is not coupled to controller kind | **Open** | Profile application can change `controllerKind` without normalizing the streaming mode. A Marlin profile can still retain char-counted streaming. |
| `.rd` verification and false golden claim | **Partial** | The false claim was corrected and an exact byte golden was added. The golden is explicitly internal consistency only; independent decoder/hardware truth remains absent. |
| Guessed `.lbdev` schema | **Open** | Tests still use synthetic XML and no real LightBurn export corpus or research record exists. |
| Safety zones do not gate jog/click | **Fixed** | Both primary jog and click-to-position paths now enforce zones with tests. A separate audit found a Z-only jog false-block edge, but the v2 root cause is closed. |
| Laser bounds/feed are not compared with the live controller | **Partial** | Laser advisories now compare profile width/height and the profile-clamped fastest output-layer feed with the controller snapshot. Feed comparison still uses one merged `maxFeed`, not X/Y axis-specific `$110/$111`, and it does not analyze actual motion direction, selected output scope, or per-object overrides. |

## Appendix A — every sector ID

### A.1 Persistence, autosave, and recovery

| ID | Status | Current result |
|---|---|---|
| A.1.1 checkpoint never revalidates work zero | **Refuted / superseded** | v2's own verifier showed the power-loss headline was already gated by placement/origin checks. Resume-specific wording could improve, but this is not an open major. |
| A.1.2 restored autosave slot survives manual save | **Fixed** | Dead slot re-homing and cleanup are covered. |
| A.1.3 scope/placement lost from checkpoint | **Open** | Same as P1-i. |
| A.1.4 +Infinity machine/CNC values | **Fixed** | Same as the finite-number Tier 2 fix. |
| A.1.5 autosave workflow/ADR drift | **Open** | `WORKFLOW.md` still lists F-C3 as a stub and there is no autosave ADR. F-A12 was changed to admit the local-profile warning is deferred, but the missing specification remains. |
| A.1.6 one global checkpoint slot | **Open** | Checkpoints still use one global record; a subsequent job replaces the prior recovery record. |
| A.1.7 dormant schema/version corpus and downgrade loss | **Open** | Schema remains version 1 and no historical fixture/downgrade protection program closes the finding. |
| A.1.8 Cancel permanently discards only recovery copy | **Open** | Dismiss still clears the checkpoint immediately with no undo/second-stage recovery. |
| A.1.9 project validator at hard-size cliff | **Open** | `project-shape-validator.ts` is 399 counted lines, one line below the 400 hard limit. |
| A.1.10 stale/corrupt autosave slot aging | **Open** | Targeted restored-slot cleanup landed; general age-based/index garbage collection did not. |
| A.1.11 no back-up-lines affordance | **Open** | Copy warns that backing up may re-burn, but Resume has no adjustable line offset. |
| A.1.12 truncated validator comment | **Open** | The fragment `// which the G-code bounds-check regex can't read` remains. |

### A.2 Electron and desktop security

| ID | Status | Current result |
|---|---|---|
| A.2.1 unsigned auto-updater | **Open** | Same as P1-j. |
| A.2.2 permission documentation omits camera/wake lock | **Fixed** | PROJECT now lists the complete allow-list and constraints. |
| A.2.3 cross-origin camera bridge | **Open** | Same as P1-k. |
| A.2.4 IPv6 ULA/link-local rejected | **Fixed** | ULA/link-local support and malformed-literal rejection landed with tests. |
| A.2.5 no desktop file association/open-file path | **Open** | No `.lf2` association or Electron `open-file`/second-instance file-open flow is configured. |
| A.2.6 PWA update prompt not desktop-gated | **Fixed** | Explicit desktop-shell gate landed. |
| A.2.7 navigation guard fail-open | **Fixed** | Handler uses the supplied URL, prevents malformed/untrusted navigation, and covers redirects. |
| A.2.8 camera/CSP duplication kept by comment only | **Fixed** | Duplication remains, but a cross-surface contract test now fails if the host/CSP sets drift. This closes the reported unguarded-drift mechanism. |
| A.2.9 PROJECT claims missing Electron layer/signed exe | **Fixed** | Documentation now describes the Electron surface and unsigned v1 executable accurately. |

### A.3 Controller abstraction and Ruida

| ID | Status | Current result |
|---|---|---|
| A.3.1 GRBL override bytes shown for every controller | **Fixed** | Capability-gated. |
| A.3.2 settle dwell hard-coded across controllers | **Fixed** | Driver marker used. |
| A.3.3 streaming mode not coupled to controller | **Open** | Same as Tier 2. |
| A.3.4 circular `.rd` verification | **Partial** | Golden and honest docs landed; independent truth did not. |
| A.3.5 Smoothie comma status unsupported | **Fixed** | Classic comma reports are parsed and tested. |
| A.3.6 grblHAL unknown error codes discarded | **Fixed** | Unknown numeric codes are retained and the overclaiming comment was corrected. |
| A.3.7 Ruida save routed by controller kind in UI | **Fixed** | Save dispatch now uses the file-only transport capability. |
| A.3.8 menu says Save G-code for Ruida | **Open** | The command registry still labels it `Save G-code...` and `Export G-code`. |
| A.3.9 FluidNC console accepts numeric `$N=value` writes | **Open** | FluidNC spreads the GRBL driver, including `prepareConsoleCommand`, which still accepts numeric setting writes after confirmation despite the read-only capability. |
| A.3.10 fragile `.rd` Blob cast and no save tests | **Fixed** | Exact-size byte copy and save-path tests landed. |
| A.3.11 duplicated Marlin/Smoothie jog-frame builders | **Fixed** | Shared relative-jog/frame builders were extracted. |

### A.4 Device profiles and machine setup

| ID | Status | Current result |
|---|---|---|
| A.4.1 File → New resets profile | **Fixed** | Same as C2. |
| A.4.2 no app-level machine list | **Open** | Same as P1-m. |
| A.4.3 connected profile apply preserves stale old values | **Partial** | Merge now accepts partial detected facts instead of blindly constructing every field, but it still overlays `args.current` whenever any controller read occurred. The stale-wizard path described by v2 remains reachable. |
| A.4.4 zones not enforced on jog/click | **Fixed** | Same as Tier 2. |
| A.4.5 guessed `.lbdev` schema | **Open** | Same as Tier 2. |
| A.4.6 no laser live travel/feed comparison | **Partial** | Same as Tier 2. |
| A.4.7 Machine Setup workflow drift | **Partial** | F-A12 now honestly marks the local-registry warning deferred. Profile Catalog, Import/Export, and Safety Zones still lack complete success/error/empty/edge workflow specs. |
| A.4.8 `.lfmachine` drops baud/camera calibration/alignment | **Open** | `canonicalProfile()` still omits `baudRate`, `cameraCalibration`, and `cameraAlignment`. |
| A.4.9 duplicate Safety Zones/editor/card/slugify code | **Open** | Both Safety Zones editors remain; the card and slug helpers remain duplicated. |
| A.4.10 catalog values lack research provenance | **Open** | No machine-specific RESEARCH_LOG entries were added. |
| A.4.11 `core/devices` barrel exceeds API cap | **Open** | Current checker reports 76 symbols, far above the 20-symbol hard threshold; the checker remains report-only. |
| A.4.12 `.lbdev` refuses Marlin/Smoothieware | **Open** | Import still gates profile creation around GRBL-like controller text and does not map all supported controller families. |

## Release and quality gates

At HEAD c70f4b87, independent `format:check`, TypeScript typecheck, application ESLint, and Electron ESLint all pass. A fresh `pnpm release:check` advanced into the full Vitest stage but did not complete within the configured 604-second command boundary, so Claude's stated **4,282 passed / 17 skipped** full-suite result was not independently reproduced here. The timeout is inconclusive, not a test failure.

Independent structural reports currently show:

- `check:index-exports`: **15 barrels over the hard 20-symbol threshold**, including `src/core/devices/index.ts` at 76 symbols.
- `check:soft-size`: **78 files over the 250-line soft limit**; `project-shape-validator.ts` is 399 lines.
- The index and size checks are report-only today, so their success exit code must not be read as architectural compliance.

The original focused verification passed **10 test files / 56 tests**. A second HEAD-c70 follow-up passed **9 files / 38 tests** covering camera resolution, Trace, fresh-Idle tool-change gating, ramp/relief resume feed, shared Console IDs, and Z-only jog behavior. The tests do not cover a `basis: 'rectified'` workspace overlay; both overlay fixtures use `basis: 'raw'`.

At handoff the worktree also contains Claude's uncommitted edits to both bridge-policy implementations and their tests. They remove the wildcard Pages-preview origin and reject every loopback proxy target; the focused bridge suite passes 2 files / 9 tests. They still trust the exact hosted production origins and can still proxy allowed private-network hosts, so these useful in-progress mitigations do not fully close P1-k's hosted-origin threat.

### Verification limitation

A fresh local dev server was started for live UI verification, but the in-app browser did not attach to the preview. No new screenshot or interactive claim is therefore counted as evidence in this document. UI classifications above rely on current component/state source and automated tests. This does not change the open/partial findings whose missing behavior is directly visible in the implementation, but a later responsive/accessibility visual pass is still required.

## Required next sequence

1. Carry the expected next tool/bit identity through the structured tool-change boundary and show it in the hold prompt. Fresh-Idle/drained-ack gating is now fixed.
2. Finish the camera bridge policy with an explicit threat decision: exact packaged/dev origins only, or a per-session capability/token handshake. Removing preview wildcards alone leaves compromise of the exact hosted origins in scope.
3. Rectify live/still overlay frames whenever `cameraAlignment.basis === 'rectified'`, or reject the overlay with a basis-mismatch state; add a rectified-basis regression.
4. Sign desktop builds and configure updater signature verification before enabling production auto-update.
5. Persist checkpoint output scope, selection identity, and placement; make mismatch diagnostics name the exact changed dimension.
6. Build an app-level machine registry, then remove stale-current-value promotion from profile application unless a field has explicit live provenance.
7. Couple `controllerKind`, `streamingMode`, dialect, baud, and console-write capabilities in one normalization policy.
8. Finish the `.lbdev` work from real LightBurn exports, and independently validate `.rd` bytes against hardware or a trusted external decoder.
9. Reproduce a completed full release gate, then address the separately report-only architectural debt: barrel splits, validator split, and missing WORKFLOW/ADR contracts.

## Bottom line

The remediation wave fixed many real defects and deserves credit: profile preservation, profile-aware Connect, finite-number defenses, autosave slot lifecycle, shared pre-emit budgets, arc bounds, controller capability routing, Smoothie parsing, Ruida save robustness, jog-zone enforcement, and several Electron hardening gaps are genuine closures.

But “all v2 findings fixed” would be inaccurate. The main register remains **13 fixed / 7 partial / 9 open**, and several remaining items sit on safety or security boundaries rather than polish.
