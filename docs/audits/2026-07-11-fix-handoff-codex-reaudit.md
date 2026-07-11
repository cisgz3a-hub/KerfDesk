# Codex re-audit of the 2026-07-11 fix handoff

**Source handoff:** `docs/audits/2026-07-11-fix-handoff-for-codex.md`  
**Re-audited HEAD:** `3bb6d3b0682b8d15316d772ed68c00432869583f`  
**Branch:** `claude/multi-sector-audit-3447b9`  
**Method:** current implementation and focused tests control; commit messages and the handoff are leads, not proof. No hardware or camera was operated.

## Verdict

The handoff is **partly correct, but not fully closed**.

The newest fixes are real and generally well-tested. The tool-change early-unlock, tool-change lifecycle handling, CNC Z-zero advisory, G1 ramp/relief resume feed, Console transcript IDs, Z-only jog guard, autosave scope restoration, loopback target ban, IPv6 structural guard, Smoothieware settle command, and formatting blocker all survive re-audit.

However, six material gaps remain:

1. checkpoint recovery still cannot reproduce a `current-position` job;
2. calibrated/rectified camera alignments are still rendered over raw overlay frames;
3. exact hosted web origins can still drive the private-network camera bridge;
4. DEV-06 can miss unsafe feed mismatches on the slower axis and object-level speed overrides;
5. the structured tool-change hold still loses the expected next-tool identity;
6. two shipped clipper2-ts boundaries remain able to throw outside `tryVectorOp`.

## Findings

### R1 · P1 · PST-02 stores placement settings, not the resolved current-position target

`JobCheckpoint.jobPlacement` is a `JobPlacementSettings` containing only `startFrom` and `anchor`. For `current-position`, `resolveCurrentPosition()` derives the actual target XY from the **live** post-crash status report and writes it into a `JobOriginPlacement.currentPosition`.

Sequence:

1. Start at work position `(100,100)` with Current Position.
2. The compiled job is translated to `(100,100)`, but the checkpoint stores only `{startFrom:'current-position', anchor:...}`.
3. The app crashes after the head reaches `(150,150)`.
4. Resume calls `prepareStartJob()` with the stored settings, resolves Current Position again as `(150,150)`, and emits differently translated G-code.
5. The fingerprint comparison refuses the resume.

The flow test proves selective-output scope recovery only; no test changes the live current position. PST-02 is therefore **partial**, not closed for all non-default placements.

**Required correction:** checkpoint the resolved `JobOriginPlacement` or equivalent trusted placement offset used by the original compile. Reuse that exact compile input on checkpoint resume while still re-running physical readiness/bounds checks against the current machine.

### R2 · P1 · Camera resolution scaling is fixed, but rectified-basis overlays remain wrong

`runAutoAlign()` de-fisheyes a calibrated capture and persists `cameraAlignment.basis: 'rectified'`. `trace-from-camera.ts` honors that contract: when the alignment basis is rectified, it requires calibration and calls `rectifyImage()` before applying the homography.

`CameraOverlay.tsx` and the captured-still branch in `WorkspaceCameraOverlay.tsx` only call `scaleAlignmentHomographyToFrame()`. They never read `alignment.basis`, never receive the calibration, and apply a rectified-basis homography directly to raw video/still pixels. Both overlay tests use `basis: 'raw'`.

The resolution-ratio defect in c70f4b87 is genuinely fixed. The wider statement that Overlay now matches Trace is false for calibrated auto-alignments.

**Required correction:** rectify raw live/still frames when `basis === 'rectified'`, or refuse the overlay with a visible basis-mismatch state. Add live and still regressions using a rectified alignment.

### R3 · P1 · Camera bridge hardening removes previews and loopback targets, but not the original hosted-origin threat

The following improvements are confirmed:

- wildcard `*.laserforge-2fj.pages.dev` access is gone;
- URL-normalized loopback spellings such as `127.1`, hexadecimal/octal IPv4, integer IPv4, `0.0.0.0`, and IPv4-mapped IPv6 are rejected by the combined URL parser, private-host guard, and loopback ban;
- the re-leveled below-policy JPEG/502 test is a legitimate unit boundary, and the separate full policy-rejection test preserves integration coverage.

But `TRUSTED_HOSTED_APP_HOSTNAMES` still permits `kerfdesk.com` and `laserforge-2fj.pages.dev`. That was part of v2 P1-k: compromise of either exact hosted application can still drive `/discover`, `/probe`, `/frame.jpg`, and private-network camera targets through the operator's loopback bridge. Blocking loopback proxy targets prevents localhost scanning, not RFC1918/ULA discovery.

The allow-list is also host-based rather than origin-based: `https://kerfdesk.com:444` is accepted because `URL.hostname` discards the port.

**Required correction:** either limit the bridge to packaged/dev origins or require an unguessable per-session capability shared by the trusted local client. If hosted access is a deliberate product requirement, record the residual compromise threat explicitly; do not call it closed by an exact-host set.

### R4 · Major · DEV-06 live feed checking is still partial

`settingsMapToProfilePatch()` collapses `$110` and `$111` to the **greater** value and exposes only one `maxFeed`. `detectLaserMachineLimitWarnings()` compares that scalar with the fastest output layer.

This misses at least two reachable cases:

- asymmetric axes, e.g. `$110=10000`, `$111=1000`, with a 5000 mm/min Y-dominant job;
- an object's `operationOverride.speed` above the controller limit while its layer's base speed remains below it.

The compiler applies object overrides before capping to `device.maxFeed`, but the warning scans only `project.scene.layers`. The seven tests omit both cases. DEV-06 is a useful advisory, not “fully implemented” against emitted job truth.

**Required correction:** retain per-axis controller rates and inspect prepared/emitted job groups plus their motion direction. A conservative interim warning may compare effective group feeds with the lesser reported XY rate.

### R5 · P2 · The original structured tool-change acceptance still lacks tool identity

The fresh-Idle plus drained-ack gate is fixed and survives adversarial review. However, `cnc-grbl-strategy.ts` emits `; tool change: load <toolName>` as a comment, while the streamer retains only the M0 boundary and the UI displays the generic “Load the next bit.” No expected tool ID/name reaches the hold state.

This does not reopen the early-unlock safety bug, but the broader v2 C1 acceptance (“name the bit”) remains partial.

### R6 · P2 · `tryVectorOp` does not cover every shipped clipper boundary

The new helper correctly wraps the converted Weld/Boolean/Offset/Dogbone calls in `vector-path-tools.ts`, `vector-path-booleans.ts`, and `dogbone.ts`.

Repo-wide, two shipped paths still call clipper2-ts directly:

- `offsetClosedPolylinesForKerf()` calls `inflatePathsD()`;
- `applyPanelFit()` / `subtractCornerReliefs()` calls `differenceD()`.

An internal clipper throw there can still escape the pure core and abort compile/generator workflows. The self-audit fix is complete for the named UI vector operations but not for “every clipper entry point.”

## Handoff item matrix

| Item | Re-audit status | Notes |
|---|---|---|
| A1 camera bridge preview/loopback hardening | **Partial** | Preview wildcard and loopback targets fixed; exact hosted origins still retain the original P1-k capability. |
| A2 checkpoint scope + placement | **Partial** | Selected scope fixed; Current Position still re-resolves from post-crash machine coordinates. |
| A3 overlay resolution rescale | **Partial** | Resolution fixed; rectified alignment basis not honored. |
| B1 tool-change readiness | **Fixed (simulator/static)** | Requires drained acks and a fresh Idle; no unsafe unlock sequence found. |
| B2 tool-change lifecycle lists | **Fixed** | Relevant reboot/alarm/error/busy consumers now include the state. Remaining omissions reviewed were non-applicable or deliberate. |
| B3 CNC work-Z advisory | **Fixed (session-knowledge contract)** | XY Set Origin no longer suppresses the Z warning; required invalidations are present. External/manual Z commands can only cause a conservative false warning. |
| B4 G1 ramp/relief resume feed | **Fixed** | Modal inherited feed and multi-step G1 descents resolve to the feed the original motion used. Native XY arcs plunge through a separate G1 first. |
| B5 Console row IDs | **Fixed** | Shared counter owns system and controller transcript IDs, including wake-lock notices. |
| B6 Z-only jog zone guard | **Fixed** | Only zero XY displacement bypasses the XY collision check; diagonal/XY motion remains checked. |
| B7 Prettier / ADR collision | **Fixed** | Formatting gate passes; ADR-127 is unique. |
| F1 clipper exception boundary | **Partial** | Named vector operations fixed; kerf and panel-fit clipper calls remain unwrapped. |
| F10 IPv6 structural validation | **Fixed** | Malformed and public forms tested/rejected; no throwing case found. |
| F4 Smoothieware settle | **Fixed in code; hardware unverified** | Driver uses `M400`; tests pass. |
| F6 soft-line report | **Fixed for operational fs faults** | Walk/read/summary failures are swallowed and the script explicitly exits 0. Syntax/import failure cannot be made report-only, but that is a build-time source error, not a runtime scan fault. |
| DEV-06 laser live limits | **Partial** | Bed dimensions work; scalar max-rate/layer-only feed analysis misses real cases. |
| DEV-02 saved machines | **Deferred feature** | Correctly not mixed into this fix branch. |
| Unsigned builds / `.lbdev` corpus / controller-mode coupling | **Open/gated** | External requirements do not make the original audit findings fixed. |

## Validation

- Focused re-audit suite: **22 files / 132 tests passed**.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm lint:electron`: passed.
- `pnpm exec prettier --check .`: passed.
- `pnpm build:electron-main`: passed.
- Full `pnpm test`: **passed** (exit 0; 382.8 seconds). The run still emits known React `act(...)` and jsdom “not implemented” diagnostics, but they did not fail the suite.
- Hardware and perceptual camera verification remain unperformed.

## Bottom line

The branch is materially improved and most Group B fixes are ready to merge on code evidence. Do not close A1, A2, A3, DEV-06, or the repo-wide clipper boundary. The highest-priority correction is A2's unresolved Current Position because it preserves the exact crash-resume failure for a normal placement mode. The camera rectified-basis mismatch and hosted-origin bridge policy follow immediately behind it.
