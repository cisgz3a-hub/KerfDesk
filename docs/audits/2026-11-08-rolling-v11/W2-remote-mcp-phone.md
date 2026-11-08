# Rolling audit v11 — W2 Remote control, MCP and phone

- **When:** 2026-11-08   **Tree:** main @ `5f09e1110` (repro tree: scratchpad `j10-main`, an export of that SHA)
- **Scope:**
  - The relay Worker and Durable Object: `services/remote-control/src/**` (pairing, cookie session, OAuth and consent, MCP handler, rate limits, action ledger, live phone socket, push), `wrangler.jsonc`.
  - The phone app: `services/remote-control/app/src/**` (pairing and QR scanner, Machine screen, Job Review sheet, import sheet).
  - Electron main: `electron/remote-access/**` (runtime, relay client, renderer queue, routes, credential store).
  - The shared command contract: `electron/mcp/*-schemas.ts`, `input-schemas.ts`, `tool-info.ts`, `machine-tool-info.ts`, `server.ts`, `stdio.ts`.
  - The renderer: `src/ui/remote-access/**`, `src/ui/remote-control/**`.
  - The desktop paths the remote calls: `start-job-flow.ts`, `use-frame-action.ts`, `frame-cnc-preparation.ts`, `laser-job-pause-resume.ts`, `laser-job-stop.ts`, `laser-home-action.ts`, `job-aware-dialogs.ts`, the Job Review gate and `before-you-start.ts`.
  - Governing ADRs:
    - ADR-564, ADR-568, ADR-569 (+ Amendments 1–3);
    - ADR-582, ADR-583, ADR-584 (+ Amendment 1), ADR-585 (+ Amendment 1), ADR-597;
    - ADR-657 (remote keeps the PC guards, fails closed);
    - ADR-125 Amendments 2–3, ADR-269 Amendments 1 and 3, ADR-306 Amendments 4–5, ADR-375 Amendments 8 and 10;
    - ADR-689 (Before you start);
    - ADR-592 Amendment 3 (refresh nonce; licensing Worker, checked only for the memory note).
- **Lenses run:**
  - L5 trust boundary: pairing, session, OAuth, consent, scopes, ledger, live socket, push, secrets.
  - L9 entry-point parity: every remote machine action against its PC twin, including Job Review, Before you start, laser-mode and setting writes.
  - L6 failure path: network loss mid-job, relay unreachable, stale phone app, refusals.
  - L4: rate limits, message sizes, malformed messages, reconnect backoff.
  - L8 change risk: the PRs merged in the area since 2026-10-27 (#1480, #1481, #1488, #1489, #1492, #1502, #1504, #1508, #1511, #1530, #1537, #1551, #1566, #1581, #1604).
  - L1 was run on ADR-569/585/657/689 clauses. L2/L3 only where a twin showed up. L7 was not re-run (no Vitest, see Not verified).
- **Counts:** 4 raised → 0 refuted (refuter pending) → P1 0 / P2 1 / P3 3 (+ 24 KNOWN still open from earlier audits).
- **Security:** no SECURITY finding. Nothing found lets a party without PC approval act, replays a used action, bypasses a scope, injects into a command, leaks artwork with sharing off, or ships a secret. No `SECURITY-DETAILS.md` was written.

## Headline

All four rolling-v2 P2s that ADR-657 and ADR-585 Amendment 1 fixed are fixed in main's code:
- Zero Z now refuses where the PC would ask.
- Set origin switches Start From to User Origin.
- A failed Disable or Revoke save deletes the credential file.
- One hold release sends one Cancel.

The relay's definite-refusal pass-through (01-P2-3) is in main's code too. **Whether the deployed Worker has it cannot be checked: this audit never called the live Worker.** The Worker's own source has not changed since 2026-10-21 (`05559db1f`), but its bundle also carries the MCP schemas and the phone app, which have changed many times since (see Deploy-dependent items).

Remote Start still runs the PC's own `runFramedPermitStart`, Job Review gate, acknowledgement and claim. The ADR-689 "Before you start" points reach the phone and MCP through the acknowledgement prompt. No remote command writes `$` settings, reads or writes a path, or sends raw G-code.

The new finding that matters is an entry-point gap on **Resume** (W2-P2-1). On a paused CNC job the PC shows, in the job panel and on the Resume button, that Resume restarts motion with no spindle spin-up when `$32=1`, or on FluidNC with no wait, and that ABORT is preferred. The phone and MCP offer a one-tap Resume with no words at all. A coordinator may weigh it as P1 (see its Severity).

Three P3s follow:
- A refused remote Start can leave a blocking native alert on the PC. That freezes the remote session, including Abort, until someone at the PC dismisses it.
- A refused remote Frame or Start reports "This information is not currently available." instead of the reason.
- A phone-started job can outlive the phone's 8-hour control session, and nothing says so.

## Status of earlier findings at `5f09e1110`

### Rolling v2 `01-remote-control.md` (2026-10-21)

| ID | Status | Evidence |
|---|---|---|
| 01-P2-1 Remote Zero Z skips the overwrite guard | **Fixed** (ADR-657, `05559db1f`) | `src/ui/remote-control/machine-actions.ts:145-149` refuses with `REMOTE_ZERO_Z_REFUSAL` when `liveZeroZOverwriteWarning` is not null |
| 01-P2-2 Remote Set origin leaves Start From on Absolute | **Fixed** (ADR-657) | `machine-actions.ts:155-158` calls the shared `placementAfterSetOrigin` |
| 01-P2-3 Relay masks definite refusals as "unconfirmed" | **Fixed in code; deployment not checkable** | `services/remote-control/src/control-actions.ts:25-29` (`stale_revision`, `invalid_input`, `busy`), `device.ts:149-155` tombstones the ID. Only a Worker redeploy puts it live; the live Worker was not called |
| 01-P2-4 Failed Disable/Revoke save loses the revocation | **Fixed** (ADR-657) | `electron/remote-access/runtime.ts:248-258` `failClosed` sends the revocation if connected, discards `remote-control.v1`, keeps the real error; used at `:323`, `:375`, `:393` |
| 01-P2-5 Hold releases spend the Abort rate allowance | **Still open** (KNOWN, awaiting the maintainer) | `services/remote-control/src/limits.ts:156-159` charges every `MCP_PRIORITY_COMMANDS` member (`abort_job`, `jog_hold_stop`, `electron/mcp/input-schemas.ts:170`) to `ABORT_LIMIT` (30/min, `wrangler.jsonc`). The ledger and renderer were fixed; the limiter was not |
| 01-P2-6 One release runs Cancel twice | **Fixed** (ADR-585 Amd 1) | `src/ui/remote-control/machine-hold.ts:146-159` `cancelOwnedMotionOnce`; test `machine-hold-release-once.test.ts:115,129` |
| 01-P3-1 Review paging says "No warnings" | Still open (KNOWN) | `services/remote-control/app/src/ui/machine-job.tsx:172-181` still keys on the page's `warnings` |
| 01-P3-2 Refresh token reuse not detected | Still open (KNOWN) | `services/remote-control/src/index.ts` unchanged since `05559db1f`; provider still `1.2.1` |
| 01-P3-3 DCR clients may skip PKCE | Still open (KNOWN) | No S256 check in `oauth.ts` |
| 01-P3-4 MCP consent extends 8 h to 30 days silently | Still open (KNOWN) | `approvals.ts:294-315`; `src/ui/remote-access/RemotePairingHost.tsx:84` still says "otherwise 8 hours" |
| 01-P3-5 A clients push refuses Abort for one round trip | Still open (KNOWN) | `electron/remote-access/runtime.ts:106` `!this.waitingClients` |
| 01-P3-6 One client can fill all 32 slots | Still open (KNOWN) | `services/remote-control/src/device.ts:238` |
| 01-P3-7 GET routes bypass ingress limits | Still open (KNOWN) | `limits.ts:175-180` |
| 01-P3-8 Relay reset says "try again" for control | Still open (KNOWN) | `relay.ts:327-329` maps any RPC failure to `unavailable` |
| 01-P3-9 Remote save of an invalid project opens a picker | Still open, latent (KNOWN) | `src/ui/remote-control/design-save.ts:26` → `src/ui/app/project-save-action.ts:148` `offerSalvageExport` |
| 01-P3-10 PROJECT.md remote paragraph stale | Still open (KNOWN) | `PROJECT.md:40` still says file exchange, connection changes and recipe/layer creation "remain outside this phase" |
| 01-P3-11 `update_operation` bounds differ from Cut Settings | Still open (KNOWN) | `electron/mcp/design-schemas.ts:64-71` |
| 01-P3-12 `update_operation` text lists four fields | Still open (KNOWN) | `electron/mcp/tool-info.ts:95-98` |
| 01-P3-13 Renderer UUID regex stricter than relay | Still open (KNOWN) | `src/ui/remote-control/validation.ts:41`, `machine-validation.ts:26` |
| 01-P3-14 `control_required` becomes `failed` | Still open (KNOWN) | `electron/remote-access/routes.ts:66-80` has no mapping |
| 01-P3-15 Discrete Z jog accepts 100 mm | Still open (KNOWN) | `electron/mcp/machine-schemas.ts:67` |
| 01-P3-16 "PC speed" jog is fixed 3000/600 | Still open (KNOWN) | `machine-execution.ts:139-142`, `machine-hold.ts:50-53` |
| 01-P3-17 No registry dead-man test | Not re-verified (no Vitest). `machine-hold-release-once.test.ts` now drives heartbeats through the adapter but does not assert the 600 ms expiry | — |

### Rolling v3 G7 and H8 (2026-10-27)

| ID | Status | Evidence |
|---|---|---|
| G7-P3-1 (P1) Remote board capture skips the Capture gate | **Fixed** (#1460, ADR-654 Amd 1) | `machine-actions.ts:197-228` |
| G7-P3-2 Crash screen decides ABORT once | Not in W2's scope (app shell, W3) | — |
| G7-P3-3 Workspace crash detaches the phone session | **Still open** (KNOWN) | `src/ui/app/App.tsx:155-156`: `useRemoteAccess()` still sits in `WorkspaceLifecycle`, inside the error boundary, not in `AppProtections` (`:175`) |
| G7-K-3 01-P2-3 needs a relay redeploy | Code present; deployment not checkable | As 01-P2-3 |
| H8-P1-1 Remote DXF on the UI thread | **Fixed** (#1465) | `design-imports.ts:290` `parseDxfOffThread` |
| H8-P1-2 Remote import silently scales to the bed | **Fixed** (#1470; phone half #1480) | receipt `notices`/`bedFit`; phone `import-sheet.tsx:135-187` |
| H8-P2-1 Remote bit change keeps old feeds | **Fixed** (#1470) | ADR-306 Amd 4 |
| H8-P2-2 Phone hold has no travel clamp | **Primary fixed** (#1470); **secondary still open** (KNOWN): bounds and no-go jog warnings reach only the PC (ADR-375 Amd 8 defers it) | `machine-hold.ts:54-89` |
| H8-P2-3 Remote import drops notices | **Fixed** (#1470) | `design-import-notices.ts` |
| H8-P3-1 Remote Home with homing off | Still open (KNOWN) | `machine-actions.ts:130-137`; `laser-home-action.ts:89-105` has no Machine Setup homing check |
| H8-P3-2 Remote review omits the jig block | Still open (KNOWN) | `machine-projections.ts` has no registration-jig field; PC `JobReviewDialog.tsx:77-80` |
| H8-P3-3 Remote Connect says "No saved connection" | Partly changed (KNOWN) | A port that will not open now says the port is busy (`machine-actions.ts:93-103`). The file-only and network cases still reach `:88-90` (READ) |

### Rolling v5 J3 and J4 (2026-10-27)

| ID | Status | Evidence |
|---|---|---|
| J3-P1-1 Remote SVG on the UI thread | **Fixed** (#1481, ADR-269 Amd 3) | `design-imports.ts:96` `parseSvgOffThread` with the request signal |
| J3-P2-1 SVG `<use>` budget counts elements | **Fixed** (#1481) | ADR-269 Amd 3 |
| J3-P2-2 Batch bit change drops the kept-values message | **Fixed** (#1480) | `design-schemas.ts:336-337` |
| J3-P2-3 (P1) Phone says "Imported." after a bed fit | **Fixed in code** (#1480, ADR-125 Amd 3); reaches phones only after a Worker redeploy | `import-sheet.tsx:135-187` |
| J3-P3-1 DXF budget counts nested copies twice | **Fixed** (#1480) | — |
| J3-P3-2 New receipt fields need a relay redeploy | **Still deploy-dependent** (KNOWN); now written into ADR-125 Amd 3:48-52, ADR-584 Amd 1:78-81, ADR-591 Amd 1:59, ADR-306 Amd 5:36 | See Deploy-dependent items |
| J3-P3-3 Phone Z hold ignores withheld MPos | **Fixed** (#1480, ADR-375 Amd 10) | `src/ui/laser/jog-hold-aim.ts:73` |
| J4 MCP/relay items (verified clean there) | Unchanged and still hold | QR scanner (#1530) re-checked below |
| J4-P3-1 Updater runs an unsigned installer | Not in W2's scope (W3) | — |

### October MCP and pairing audits

Each of these was repaired in its own PR. The repairs were spot-checked in the code and are still present:
- **2026-10-02 pairing and mobile setup:**
  - presentation-only lifetime: `security.ts:34-36` `remainingPairingMs`;
  - lower-casing the device ID: `app/src/core/phone-transport.ts:61` (the new React app keeps it).
- **2026-10-02 ChatGPT linking:** the Bearer challenge and the `securitySchemes` mirror, `mcp-auth.ts`.
- **2026-10-05 feature hunt and canvas usability:** not re-run. They are phone UI behaviours with browser tests.
- **2026-10-14 MCP bug audit:**
  - ordinary-first hold-stop capacity: `control-actions.ts:58-67`, `machine-control-registry.ts:164-179`;
  - cancellation before admission: `device.ts:309-339`.

### Memory-note checks

- **ADR-657 / 01-P2-3 redeploy owed.** The fix is in main's Worker source (`control-actions.ts:25-29`, `device.ts:149-155`). Whether the live Worker runs it **cannot be checked**; this audit never contacted it.
- **ADR-592 Amd 3, the Worker still echoes the refresh nonce.** This is the *licensing* Worker. Main's code still does:
  - `services/desktop-licensing/authority.mjs:240` accepts an optional nonce;
  - `:353-354` signs it back;
  - the app checks none (`electron/licensing-grant.ts:100-114`).

  This is the decided state (ADR-592 Amd 3 item 3). The deployed licensing Worker was not checked either.

## Findings

### W2-P2-1 — Remote Resume of a paused CNC job gives no warning; the PC says Resume restarts motion with no spindle spin-up ($32=1, or FluidNC with no wait) and to prefer ABORT JOB

- **Where:**
  - Remote availability: `src/ui/remote-control/machine-projections.ts:126-130`. `resume` carries only the approval, offline and "No paused job" reasons.
  - Remote action: `src/ui/remote-control/machine-actions.ts:230-242`. `executePauseResume` calls `resumeJob()` directly.
  - Phone: `services/remote-control/app/src/ui/machine-job.tsx:119-126`. A plain Resume button, one tap, no confirmation and no text.
  - MCP: `electron/mcp/machine-tool-info.ts:72-76`. Only "the machine moves and the tool may turn on".
  - Desktop twin, which shows the warning:
    - the paused job panel's visible text: `src/ui/laser/JobRunControls.tsx:42-48, 55-61, 66, 90`, mounted through `JobControls.tsx:193-199` in `LaserWindow.tsx:148`;
    - the Live Motion Resume button title: `src/ui/laser/LiveMotionBar.tsx:153-159, 187-193`.
  - The texts: `src/ui/state/cnc-pause-resume-policy.ts:11-14, 20-27, 36-51, 86-101`. For example, "Laser mode ($32) is on, so Resume restarts motion at once with NO spindle spin-up: the stopped bit is pushed through the cut. Prefer ABORT JOB…". FluidNC: "With no wait, the bit is fed through the cut while it is still speeding up. Prefer ABORT JOB…".
- **Anchor:**
  - Twin: the PC's CNC resume advisory (`cncResumeAdvisoryNotice`) against the remote Resume.
  - Contract: ADR-585's table promises the remote `pause_job`/`resume_job` "with their controller confirmation, laser-mode and door rules" (`docs/decisions/ADR-585-expanded-remote-machine-control.md:15`). The laser-mode rule for a CNC Resume is this advisory: the store does not refuse, it warns (CNC audit MC-1, ADR-180 Amd 7).
  - Rolling v3 H8 rated Pause/Resume "Clean" because both call the same store action (`H8-remote-automation.md:70`). The advisory twin was not checked.
- **Scenario:**
  1. A GRBL CNC with `$32=1` left over from laser use, or any FluidNC router with the default `spinup_ms` of 0, runs a pocket started from the phone.
  2. The operator pauses from the phone. Pause uses the door byte, so the spindle stops; the bit stays in the cut unless Pause and lift lifted it.
  3. On the PC, the paused job panel and the Resume button say Resume will push the stopped bit through the cut, or feed it while it spins up, and to prefer ABORT JOB and recover.
  4. The phone shows "Paused" and a Resume button. `get_machine_status` reports `availability.resume.available = true` with no reason. One tap resumes.
  5. The bit is driven through the cut without spindle speed. The likely results are a broken bit, a damaged part or a thrown workpiece.
  6. An MCP agent asked to "resume" has nothing to relay to the user either.
- **Evidence:** READ.
  - `machineStatusProjection` (`machine-projections.ts:31-60, 105-131`) builds `job` from `jobProjection` (`:166-175`), which holds `active`, `state` and `progressPercent` only, plus timing. No field carries `cncResumeAdvisoryNotice` or `pauseControlMessage`.
  - `git grep -e cncResumeAdvisoryNotice -e resumeControlTitle -- src/ui/remote-control services/remote-control` finds nothing.
  - The secondary half, for Pause: the PC Pause title `pauseControlMessage` (`LiveMotionBar.tsx:170-177`) explains stream-side pauses, for example on Marlin, which cannot stop the beam at once. The remote Pause has no such note. That half is P3 on its own.
  - Not reproduced: memory stayed under the Vitest gate until the end of the audit. The refuter should reproduce it, for example with a paused CNC streamer, `activeJobMachineKind: 'cnc'` and `$32=1` in the laser store, then `machineStatusProjection` against `cncResumeAdvisoryNotice`.
- **Severity:** P2, with a P1 argument for the coordinator.
  - **For P2:** the motion itself is the motion the operator asked for. The hazard is the firmware's no-spin-up resume, which the PC also allows; it only warns. Spindle speed is not one of §3's four physical quantities.
  - **For P1:** §3 lets a P1 be lowered only when "a clear warning reaches the operator before the output". This is the same position as J3-P2-3, which the refuter raised to P1: a phone-only workflow, with the warning only on a PC screen the operator is away from.
- **Novelty:** not KNOWN. No audit mentions remote Resume and the CNC advisory. No open PR touches `machine-projections.ts`, `machine-actions.ts` or the phone `machine-job.tsx`. #1615 touches `LiveMotionActionButton.tsx`, for held Enter only.
- **Refuter:** PENDING.
- **Fix direction:**
  - Project the PC's `cncResumeAdvisoryNotice` (and the Pause message) into `get_machine_status` as the Resume and Pause reason or a `job.notice`.
  - Show it on the phone above the button, as the review's acknowledgement is shown. Consider making the phone confirm Resume (a slide, like Start) whenever the advisory is present.
  - This needs a Worker redeploy for the phone page and for MCP clients, because the Worker re-parses `get_machine_status` with its bundled schema.

### W2-P3-1 — A refused remote Start opens a native `window.alert` on the PC; the renderer, and with it every remote command including Abort, waits until someone at the PC dismisses it

- **Where:**
  - `src/ui/laser/start-job-authorization-reporting.ts:40-43` (`reportBlockedStart` → `jobAwareAlert('Cannot start job…')`), also reached from `:49-58`.
  - `src/ui/laser/start-job-transmission.ts:130-133` (`jobAwareAlert('Could not start job…')`).
  - `src/ui/state/job-aware-dialogs.ts:21-31`: `window.alert` whenever no job is active.
  - Reached from the remote Start: `src/ui/remote-control/machine-execution.ts:171` → `runFramedPermitStart` → `start-job-flow.ts:192` and `:277-285`. The refusals come from `start-job-authorization.ts:38-90`:
    - the claim changed;
    - the power range changed;
    - "Controller or machine setup changed while Start was being prepared".
- **Anchor:**
  - Twin: the remote Frame is made dialog-free on purpose. `interactiveSetup: false` skips `offerFrameBlockerFixes` (`use-frame-action.ts:112`) and the CNC Zero-Z confirm (`frame-cnc-preparation.ts:25-28`). The remote save never opens a picker (`design-save.ts:10-22`).
  - Contract: ADR-569: "Abort ingress remains available while an ordinary request is pending" (quoted in G7-P3-3).
  - Same class as 01-P3-9: a remote action that opens a blocking PC dialog.
- **Scenario:**
  1. A phone operator confirms Start in the phone review.
  2. Between the review and the final authorization the controller's state or settings change, for example a status report shows a changed setup, or a `$$` re-read changes the power range.
  3. The PC renderer calls `window.alert("Cannot start job: …")` and stops processing.
  4. Electron main's queue cannot deliver to the frozen renderer. Every remote request times out (renderer queue 20 s, relay `COMMAND_TIMEOUT_MS`), including `get_control_operation` and Abort.
  5. The phone ends up with an unconfirmed receipt and no reason.
  6. Nothing moves in this path: the refusal is before the first byte, so this is P3.
  7. Not verified: whether a transmission error after a delivered prefix (`start-job-transmission.ts:112-121`) can reach the same alert while the controller still runs that prefix.
- **Evidence:** READ. `reportStartAuthorizationRefusal` and `transmitPreparedStart` take no caller or presenter option. The remote passes only `executionOwner`, `presenter` and `onStartCommitted` (`machine-execution.ts:171-182`).
- **Refuter:** PENDING.
- **Fix direction:** Report Start refusals through the presenter or execution owner. For a remote owner, record the message on the operation (privately when sharing is off) and toast on the PC instead of `window.alert`.

### W2-P3-2 — A refused remote Frame or Start reports "This information is not currently available." instead of the reason the PC shows

- **Where:**
  - `src/ui/remote-control/machine-execution.ts:155-157` (Frame) and `:166-167, 183-184` (Start) throw `RemoteFault('unavailable')`.
  - The message comes from `src/ui/remote-control/fault.ts:14`.
  - `machine-owned-operation.ts:168-173` copies it to the receipt.
  - The phone toasts it (`app/src/core/control-operation.ts:28-29`).
  - The PC gets the real reason as a toast and a start blocker (`src/ui/laser/frame-dispatch-support.ts:138-146`).
- **Anchor:**
  - Twin: the PC Frame refusal text, and the remote's own `MachineRefusal` (`machine-actions.ts:22-28`), which carries fixed controller-state reasons for Connect, Home and board.
  - Contract: ADR-569 receipts that distinguish stages and outcomes.
- **Scenario:**
  1. A CNC operator presses Frame on the phone before setting work Z zero.
  2. The PC toasts the CNC work-Z requirement (`frame-cnc-preparation.ts:25-27`).
  3. The phone toasts "This information is not currently available." and the operator does not learn why.
  4. The same happens for:
     - a Frame refused for an Alarm, a placement or an origin offset;
     - a Start with no completed Frame (`:166-167`);
     - a Start that `runFramedPermitStart` refused (`:183-184`).
  5. MCP agents get the same text.
  6. Nothing moves.
- **Evidence:** READ.
- **Refuter:** PENDING.
- **Fix direction:** Capture the Frame/Start refusal messages for a remote owner. They are fixed controller and placement strings, and `MachineRefusal` already filters paths and URLs. Hide them behind `privateMessage` when they name artwork.

### W2-P3-3 — A phone-started job can outlive the phone's 8-hour control session; neither the phone nor remote Start says when Pause and Abort will stop working

- **Where:**
  - `services/remote-control/src/protocol.ts:15` (`SESSION_TTL_MS` 8 h).
  - `pairing.ts:228-230`: the lease is fixed at approval.
  - `approvals.ts:238-248`: an expired session is `unavailable`, so the phone gets 401.
  - The phone app shows no session or lease expiry (`git grep -i expires services/remote-control/app/src` finds only the pairing countdown).
  - Remote Start does not compare the job's remaining time with the lease (`machine-execution.ts:161-189`).
  - On expiry the job keeps running (`machine-owned-operation.ts:51`: a committed job is never cancelled by the registry). That is right, but the phone loses Pause and Abort silently.
- **Anchor:**
  - Twin: the PC states the 8-hour limit only once, at approval (`src/ui/remote-access/RemotePairingHost.tsx:79-84`).
  - Contract: ADR-569: "Abort ingress remains available while an ordinary request is pending".
  - Counter-anchor: ADR-569 and ADR-689 say remote Abort is not an emergency stop and "A camera or phone is not supervision".
- **Scenario:**
  1. A phone is paired at 09:00 with control and the default session.
  2. At 16:20 the operator Frames and Starts a 90-minute CNC job from the phone, then moves around the shop with the phone.
  3. At 17:00 the session expires. The phone shows the pairing screen. Pause and Abort from the phone no longer exist while the job runs.
  4. Nothing warned at Start or before expiry.
- **Evidence:** READ.
- **Severity:** P3. Supervision at the machine is required anyway (ADR-689), and the PC ABORT and the physical E-stop are unaffected. The defect is the missing disclosure.
- **Refuter:** PENDING.
- **Fix direction:**
  - Project the lease's remaining time in `get_machine_status`.
  - Warn in the remote review when the estimate exceeds it, and on the phone shortly before expiry.
  - Alternatively, extend the control lease while a job this client started is running, as ADR-583 allows longer sessions by explicit choice.

## Deploy-dependent items (cannot be checked)

The relay Worker bundles three things:
- `electron/mcp/*-schemas.ts`: it re-parses every desktop result with them (`device.ts:358`, `relay.ts:343`);
- the phone app (`public/app/*`, built from `app/src`);
- its own `src`.

Its `src` last changed on 2026-10-21 (`05559db1f`). Main has these Worker-visible changes since then. Each reaches phones or remote MCP clients only after a Worker redeploy:
1. ADR-657: definite refusals pass through (01-P2-3).
2. #1362 / ADR-654: the board tools for MCP clients (G7-K-3).
3. #1470 / #1480: import `notices` and `bedFit`, the phone import sheet showing them (J3-P2-3, which the refuter rated P1), and the batch `results[].message` (ADR-306 Amd 5).
4. #1492: the `undo`/`redo` machine notices (ADR-584 Amd 1).
5. #1504: the board array count.
6. #1508: the missing-glyph `notices` on text receipts (ADR-591 Amd 1).
7. #1530: the phone QR scanner fallback.
8. #1604: the phone accessibility CSS.

ADR-689 (Before you start) needs no redeploy: it rides the existing `prompt` field, under the 2048-character bound. The live Worker was never contacted, so which of these are deployed is unknown. W2-P2-1's fix would add one more item.

## Refuted

Candidates dropped by the auditor:
- **"Remote Start skips the PC's Start-button checks."** Dropped. `runStartJobFlow` adds only `clearStartBlockers` and the readiness toast. Every guard runs inside `runFramedPermitStart` (`start-job-flow.ts:114-159`): the mark-ownership refusal, `framedRunReadinessIssue`, the review gate, the claim and both authorizations. The PC button's `autofocusBusy` disable has a store-level twin in `framed-run-invalidation.ts` and `start-job-readiness.ts`.
- **"The remote Job Review skips the laser-mode or CNC acknowledgement."** Dropped. The PC dialog's Confirm click is the acknowledgement (`job-review-gate.ts:250-274`). The phone and MCP get the same prompt through `remoteReviewAcknowledgement` (`machine-projections.ts:279`), and the phone needs a slide (`machine-job.tsx:158, 217-229`).
- **"The remote Frame can Zero Z without asking."** Dropped. With `interactiveSetup: false`, a CNC Frame without work Z is refused, not zeroed (`frame-cnc-preparation.ts:25-28`).
- **"A remote can write `$32` or other settings."** Dropped. No remote command writes a setting; `SendLaserModeButton` is PC-only behind a confirm.
- **"Remote Abort leaves an unowned laser on."** Dropped. `stopJob` sends a soft reset whenever the driver has one (`laser-job-stop.ts:112-125`), which turns the output off. The PC's `LASER OFF` sends `M5` to keep the origin; the remote's reset costs the origin but not safety. See Not verified.
- **"Remote Resume during a CNC lift bypasses the PC's disabled button."** Not raised. `runConfirmedResumeJob` re-enters a lift only through `resumeLiftedCncJob` and its `reentryBlockMessage` (`cnc-pause-reentry-run.ts:41-51`). The lift-phase refusal was read, not run.
- **"The QR scanner (#1530) can be steered to another origin."** Dropped. `pairingFromLink` accepts only the production or same origin, `/control` or `/app/`, no query, no credentials, and exactly `device` plus `code` in the fragment (`app/src/ui/Pairing.tsx:15-33`). Scanned text is never navigated to, and frames stay on the phone.
- **"Pairing codes can be brute-forced."** Dropped, as in v2. The DO counts 5 failures per one-use offer (`approvals.ts:200-212`), and the code is 12 symbols from 63.

## Verified clean

- **Pairing:**
  - One-use offer, 5 attempts, owner online, serialized (`approvals.ts:189-236`).
  - A new offer revokes pending claims (`pairing.ts:193-196`).
  - The PC chooses a subset of the requested scopes (`pairing.ts:211-233`; `runtime.ts:341-360`).
  - 20 clients at most.
  - Phone sign-out, PC revoke and revoke-all remove the client, consents, ledger, MCP associations, push and sockets (`approvals.ts:328-343`, `device.ts:116-122`).
  - Disable and Revoke fail closed (ADR-657).
- **Sessions:** `__Host-` cookie, HttpOnly, Secure, SameSite=Strict, server-side expiry never renewed by status (`public.ts:95-101`). CSRF header plus exact Origin on every phone POST (`security.ts:134-145`). Digests are compared with `timingSafeEqual`.
- **Authorisation, three layers:**
  - Relay: `commandAuthorized` (`device.ts:252-263`).
  - Main: `parseCommand` scope check and `canRequest` against the relay list and the control lease (`relay-client.ts:46-71, 142-152`; `runtime.ts:95-112`).
  - Renderer queue (`renderer-queue.ts:87-92`) and registry: authority and caller match (`machine-control-registry.ts:143-163`).
  - Hold heartbeats count only with a live control lease (`runtime.ts:177-185`, `live.ts:169-179`).
- **Replay:** the control ledger keys `clientId:requestId` with a fingerprint and lease. A used ID is never dispatched again, and a refusal stays a refusal (`control-actions.ts:105-164`). The renderer receipts conflict on a changed fingerprint (`machine-control-registry.ts:133-142`).
- **OAuth:**
  - Consent is bound to the paired phone session, single-use in the DO (`consent-binding.ts`, `approvals.ts:91-145`).
  - Edit and control are refused unless the PC approved them (`oauth.ts:84-99, 140-147`).
  - Audience is checked (`mcp.ts:29-37`).
  - The challenge carries fixed text only (`mcp-auth.ts`).
- **MCP input:** zod `strictObject` on every tool, with bounded errors that do not echo arguments (`input-schemas.ts:150-170`). `import_file` takes a plain file name (`design-schemas.ts:36-40`), not a path. `save_project` writes only to the existing `lastSaveTarget` (`design-save.ts:10-22`). There are no raw G-code, console, shell, path or `$` commands. The stdio server (`stdio.ts`) has no caller.
- **Artwork and privacy:**
  - The preview, scene, text, camera and review messages are gated on the sharing opt-in before and after async work, including the new fill-pool preview (`preview-projection.ts:36, 79`).
  - Missing-glyph notices name characters only when the client sent the wording (`text-notices.ts:29-40`).
  - The Worker stores no artwork. It keeps device and client metadata, the ledger without review strings (`control-actions.ts:212-223`), consent snapshots (10 min), the push endpoint (`push.ts:20-41`, known hosts only) and OAuth KV.
  - Push bodies are three fixed strings (`push.ts:13-17`).
  - The Worker has no `console.*` calls.
- **Secrets:** none in `services/remote-control`, `electron/remote-access` or `electron/mcp`. `wrangler.jsonc` holds the account and KV IDs only, and VAPID keys come from the environment.
- **Limits:**
  - Body bounds: the Worker streams them (`index.ts:92-106`, `security.ts:57-90`); main limits 280 KB (`routes.ts:14-37`); the relay frame is `maxPayload`.
  - Phone socket: 512 characters and 30 messages/s (`live.ts:183-204, 251-260`).
  - Pending caps: 32 plus 4 priority, at relay, main and queue.
  - Reconnects back off from 1 s to 30 s on desktop (`relay-client.ts:123-131`) and phone (`phone-transport.ts:253-261`).
  - A malformed desktop message closes the socket (`device.ts:367-380`).
- **Before you start (ADR-689):** the projected prompt holds the safety lines for every kind (`before-you-start.ts:38-47`, `machine-projections.ts:279`).
- **Network loss mid-job:**
  - A relay close cancels in-flight requests (`relay-client.ts:271-276`).
  - Holds are released (`'*'` signal).
  - A committed job keeps running (`machine-owned-operation.ts:51`).
  - The phone shows the PC offline. That is ADR-569's stated limit.

## Not verified

- **The deployed relay and licensing Workers.** They were never contacted, by rule, so it is unknown which Deploy-dependent items are live.
- **The Worker's workerd tests and the phone Playwright UI tests.** `services/remote-control/node_modules` is absent in both the repro tree and the main checkout, and nothing was installed. `build-app.mjs --check` could not run either: `esbuild` and `@nuintun/qrcode` do not resolve from the root store. So the freshness of the committed `public/app` bundle against `app/src` is unverified, and CI, which normally checks it, has been blocked since 2026-11-06.
- **No Vitest or browser run.** Available memory was 0.3–1.4 GB for most of the audit, below the 1.5 GB gate. Every new finding is READ. W2-P2-1 needs a refuter REPRO before the coordinator weighs P1. 01-P3-17 was not re-checked by mutation.
- **W2-P3-1's prefix case:** whether a transmission error after a delivered prefix can reach the blocking alert while the controller still runs that prefix (`jobActive()` at that moment).
- **Remote Abort's soft reset where the PC sends `M5`** (a laser left on at Idle): whether the lost origin is detected before the next Frame and Start.
- **The CNC lift-phase refusal on remote Resume:** read, not run.
- **Real networks and hardware:** heartbeat timing, relay latency, Cloudflare limiter consistency and phone browser variants. No hardware was operated.

```json
[
  {"id":"W2-P2-1","severity":"P2","area":"remote-mcp-phone","file":"src/ui/remote-control/machine-projections.ts","line":126,"anchor":"Twin: src/ui/laser/JobRunControls.tsx:42-90 and LiveMotionBar.tsx:153-193 cncResumeAdvisoryNotice; Contract: ADR-585 table row pause_job/resume_job 'laser-mode and door rules'","evidence":"READ","verdict":"PENDING","known":false,"summary":"Remote Resume of a paused CNC job shows no advisory; the PC warns that Resume restarts motion with no spindle spin-up ($32=1 or FluidNC) and to prefer ABORT JOB (P1 argument noted for the coordinator)"},
  {"id":"W2-P3-1","severity":"P3","area":"remote-mcp-phone","file":"src/ui/laser/start-job-authorization-reporting.ts","line":42,"anchor":"Twin: remote Frame interactiveSetup:false (frame-cnc-preparation.ts:25-28), remote save no picker (design-save.ts:10-22); Contract: ADR-569 Abort ingress","evidence":"READ","verdict":"PENDING","known":false,"summary":"A refused remote Start opens window.alert on the PC, freezing the renderer and every remote command including Abort until dismissed at the PC"},
  {"id":"W2-P3-2","severity":"P3","area":"remote-mcp-phone","file":"src/ui/remote-control/machine-execution.ts","line":157,"anchor":"Twin: PC Frame refusal toast (frame-dispatch-support.ts:138-146) and remote MachineRefusal; Contract: ADR-569 receipts","evidence":"READ","verdict":"PENDING","known":false,"summary":"A refused remote Frame or Start reports 'This information is not currently available.' instead of the PC's reason"},
  {"id":"W2-P3-3","severity":"P3","area":"remote-mcp-phone","file":"services/remote-control/src/protocol.ts","line":15,"anchor":"Twin: PC approval dialog states 8 h (RemotePairingHost.tsx:84); Contract: ADR-569 Abort ingress (counter: ADR-689 phone is not supervision)","evidence":"READ","verdict":"PENDING","known":false,"summary":"A phone-started job can outlive the 8-hour control session; nothing warns at Start or before expiry that phone Pause/Abort will end"}
]
```

## Refuter (2026-11-08)

- **Tree:** main @ `5f09e1110` (scratchpad export `j10-main`; `git diff 5f09e1110 HEAD -- src electron services` is empty, and the cited files compare equal to `git show 5f09e1110:<path>`).
- **How the repros ran:** two focused Vitest files in the refuter's scratchpad (`zz-w2r/src/ui/zz-w2r-resume.test.ts`, `zz-w2r/src/ui/zz-w2r-start.test.ts`), driven by a scratchpad config (`zz-w2r/vitest.w2r.config.mts`) that roots at `j10-main` with one worker:
  `node node_modules/vitest/vitest.mjs run --config <scratchpad>/zz-w2r/vitest.w2r.config.mts zz-w2r-<name>`.
  They use the real remote adapter, registry, store and Job Review gate. The CNC case runs on the repo's scripted GRBL simulator with a FluidNC banner. Memory was 1.4–1.8 GB at each launch. Results: `zz-w2r/resume.json`, `start.json`, `toolchange.json`. Nothing was installed. No hardware, live Worker or deployed endpoint was touched.
- **Security:** no SECURITY finding. No `SECURITY-DETAILS.md` was written.

### Verdicts

**W2-P2-1 — CONFIRMED (REPRO). SEVERITY CHANGE: P2 → P1** for its worst reachable branch, a FluidNC router at `$32=0`. The GRBL branches stay P2.

- **REPRO** (`zz-w2r-resume.test.ts`, test 1). Setup: simulator with banner `FluidNC v4.0.3`, `$32=0`, project machine `DEFAULT_CNC_MACHINE_CONFIG`, a real CNC `startJob`. Steps: remote `pause_job`, then `get_machine_status`, then remote `resume_job`.
  - Pause: the receipt is `"Paused."`. The outbound carries `0x84`. The lift skip reason is "KerfDesk does not lift the bit on FluidNC."
  - The PC's `cncResumeAdvisoryNotice(...)`, computed from the same store selectors `JobRunControls.tsx:37-48` uses, returns `CNC_RESUME_FLUIDNC_ADVISORY_MESSAGE` ("…the bit is fed through the cut while it is still speeding up. Prefer ABORT JOB…").
  - The remote status says `job: {active: true, state: "paused"}` and `availability.resume: {available: true}`, with no reason. The whole status JSON has no "spin-up", "spinup" or "speeding up". Its only "ABORT" strings are the generic "A job is active. Request ABORT before sending setup…" reasons on the other actions.
  - Resume: the outbound after it starts with `~`, the receipt is `"Resumed."`, and the streamer is back to `streaming`.
  - Code:
    - `machine-projections.ts:126-130` (the resume gate), `:166-182` (the job projection);
    - `machine-actions.ts:230-242` → `laser-job-pause-resume.ts:185-215`: the retry lift is refused on FluidNC (`cnc-pause-reentry.ts:63-65`), then the door resume and the refill, with no host wait;
    - the phone's one-tap Resume (`app/src/ui/machine-job.tsx:119-126`);
    - the MCP text (`machine-tool-info.ts:72-76`).
- **Physically:**
  - FluidNC's door restore runs `restore_spindle()` and then waits only `spinup_ms`, whose default is 0, before motion continues. Source: `Spindle.h:182-188`, `Parking.cpp:147-158, 185-187` @ `6735500`, fetched by the D4-P2-2 refuter and re-checked clean by meta M5 row 35. This refuter did not re-fetch it (no-download rule), so that anchor is **UNVERIFIED here, inherited**.
  - So on a relay- or PWM-switched spindle, the stopped bit, which the Pause left in the kerf, is fed at cutting feed while the spindle accelerates from rest. It does not plunge: Z is unchanged, and the move continues the interrupted XY line inside the cut.
  - The results: a stalled, dragged or broken bit, a torn edge, and possibly lost steps that GRBL-family firmware does not detect (CNC full audit 2026-09-24, line 24).
- **Why P1:**
  1. Effect class: meta-v1 M3-P3-5 rated "starts each G1 plunge from rest" (D4-P2-1) as P1 by effect under §3 "power".
  2. Reach: the same physical state here is reached by a phone- or MCP-only operator.
  3. Warning: no warning reaches that operator before output. The Start review's `$32` warnings (`controller-readiness-messages.ts:141-151`, `controller-readiness.ts:185-193`) fire only for `$32=1` or an unknown `$32`, and nothing at Start names FluidNC's `spinup_ms`. `git grep spinup_ms -- src` finds only `cnc-pause-resume-policy.ts`.
  4. Precedent: this is the J3-P2-3 position. The warning exists only on a PC screen the operator is away from. ADR-689's "a phone is not supervision" does not help, because standing at the machine does not reveal the firmware's spin-up configuration.
  5. Contrast: D4-P2-2, the same physics, stayed P2 because the PC did show a warning (then a wrong one).
- **Branches that stay P2:**
  - GRBL/grblHAL at `$32=1` or unknown `$32`: the phone review already carries the `$32` warning, whose text says "Resume after a pause restarts motion with no spin-up".
  - GRBL at `$32=0`: Pause and lift lifts the bit (`laser-job-pause-resume.ts:182`), and the door resume waits 4 s.
  - The FluidNC branch alone carries the P1. The coordinator may split it.
- **The Pause half:** confirmed. The FluidNC remote Pause receipt is a bare "Paused." and does not say the bit stays in the cut, while the PC Pause title does (`cncPauseMessage`, `cnc-pause-resume-policy.ts:117-123`). It belongs to the same fix.

**W2-P3-1 — CONFIRMED (REPRO), P3 kept.** The answer to the key question is **no**: the phone's Abort cannot be held behind this alert while a job runs or while remote motion is in flight.

- **REPRO** (`zz-w2r-start.test.ts`, test 1). The phone reviews, then approves. Inside `startJob` a controller fact changes (the trusted-position epoch) before `assertFinalStartAuthorized()`.
  - Result: `window.alert` is called once, with "Cannot start job: The completed Frame permit was consumed, replaced, or revoked while Start was being prepared…".
  - At that moment `isActiveJob` is false and the connection is still connected. The remote receipt is `failed`, "This information is not currently available."
  - In Electron, `window.alert` blocks the renderer, and the renderer *pulls* remote work (`renderer-session.ts` poll → `renderer-queue.ts:52-69`). So every remote command, Abort included, waits until the alert is dismissed. The auditor's mechanism holds.
- **Why it cannot happen during a job:**
  1. `jobAwareAlert` toasts whenever `isActiveJob` is true (`job-aware-dialogs.ts:25-31`). That covers `streaming`, `paused`, `tool-change`, `done` and `errored` (`laser-store-helpers.ts:76-80`).
     - REPRO (test 2): `reportStartAuthorizationRefusal({kind:'blocked'})` under each of those five statuses produced 0 alerts and 1 toast.
  2. A remote Start while a PC job runs never reaches a reporter. REPRO (test 2): `review_machine_job` ends `failed` with 0 alerts. Code: `framedRunReadinessIssue` returns false silently (`start-job-flow.ts:122-124`); with no permit, `machine-execution.ts:166-167` throws `unavailable`.
  3. While a remote Start is preparing, no other remote motion is admitted, from the same client or a second one. `assertVacant` (`machine-control-registry.ts:180-192`) counts every caller's uncommitted job operation.
     - REPRO (test 3): during `awaiting_review`, and again while `startJob` itself was pending, `jog_hold_start`, `jog_machine`, `frame_job` and `home_machine` from phone A, and `jog_hold_start`, `jog_machine`, `frame_job` and `review_machine_job` from phone B (its own caller and authority), all returned `busy`.
     - So a "second phone" cannot have motion running when the alert opens.
  4. Nothing queued behind the alert runs late. An undelivered renderer request is deleted at 20 s and never delivered (`renderer-queue.ts:99-107`); only the delivered one is listed as cancelled.
  5. The prefix case (the auditor's open item), REPRO (test 4). After a delivered prefix, a `JobStartTransmissionError` with the stream marked `errored` (as `containActiveStreamTransportFault` does, `laser-stream-heartbeat-containment.ts:205-222`) gives a **toast**, not an alert. An alert appears only after `buildPortClosePatch` (`laser-store-helpers.ts:439-447`) has set the connection to `disconnected`. By then the GRBL quarantine has already sent its own reset (`:237-246`), and no software Abort, PC or phone, has a transport.
- **What remains:** the alert can stall the remote only while the machine is idle and the job refused. Motion the PC operator starts on the PC during the window is PC-attended. So P3 holds.

**W2-P3-2 — CONFIRMED (REPRO), P3 kept.** Two repros:
- the refused Start above;
- a `review_machine_job` sent while a PC job streams.

Both receipts read `failed`, "This information is not currently available." (`machine-execution.ts:166-167, 183-184`; `fault.ts:14`). The Frame branch (`:155-157`) is the same throw and was not run separately. Mitigation that keeps it at P3: `get_machine_status` already gives the phone a reason for a disabled Start or Frame ("A job is active. Request ABORT…" in the repro).

**W2-P3-3 — CONFIRMED (READ), P3 kept.**
- The 8-hour session (`protocol.ts:15`) and its lease are fixed at approval (`approvals.ts:227-229`; `pairing.ts:48-50`) and are never renewed by status (`public.ts:95-101`).
- `sessionInfo` returns `unavailable` once either one passes (`approvals.ts:238-248`).
- The phone app has no expiry display: `controlExpires`, `leaseExpires` and `sessionExpires` do not appear in `app/src`; `expiresInMs` appears only for the pending pairing.
- A committed job is never cancelled by the registry (`machine-owned-operation.ts:51-52`).

The P3 reasoning (PC ABORT and the E-stop are unaffected; ADR-689) stands.

### Challenges to "Verified clean"

- **Authorisation of every remote action:** holds.
  - `assertAdmission` runs before `start_job` approval, hold stop and Abort (`machine-control-registry.ts:85, 143-163`).
  - `approve` also matches the review's own client and session (`:223-231`).
  - Status and operation reads are caller-scoped. Main still gates them on `canControl` (`renderer-queue.ts:89-93`).
- **Remote Start keeps the desktop guards:** holds.
  - The phone's confirm is the native `JobReviewPresentation.confirm` (`machine-review-presenter.ts:32-39`), held while the review is preparing, blocked or mid-edit (`:96-121`).
  - Review warnings are projected, the cut-before-engraving warning among them (privately when sharing is off, `machine-review-pages.ts:114-123`). Only the one-click Cut last and Send `$32=0` buttons are PC-only, which is already V7-P2-3 territory.
  - **Gap noted:** the Start review has no FluidNC `spinup_ms` line at all. That is the root of W2-P2-1's P1 branch.
- **`$` writes:** none. `MACHINE_COMMANDS` (`machine-validation.ts:5-23`) has no settings command. Set origin calls the PC's own `setOriginHere`/`zeroZHere` (`machine-actions.ts:139-161`).
- **MCP file paths:** `import_file`'s name is a label only. The bytes arrive as base64 (`design-schemas.ts:31-40`) and become an in-memory `File` (`design-imports.ts:305`). No filesystem path is read or written. `stdio.ts` has no caller (no import anywhere; `package.json` `bin` lists only `kerfdesk-trace`).
- **Pairing replay and brute force:** hold (`approvals.ts:189-236`):
  - one offer, `claimed` once, at most 5 wrong digests, then dead;
  - claims serialized by `blockConcurrencyWhile`;
  - a claim only creates a *pending* client that the PC must approve.
  - Someone who knows the device ID can spend an offer's 5 attempts. That is pairing denial of service, not access, and needs a new offer from the PC. It is not raised.
- **H8's dropped candidate "remote `resume_job` during a CNC tool-change hold"** was re-run as a REPRO (`toolchange.json`). It stays dropped:
  - `~` goes to an Idle controller, and nothing past the M0 is sent;
  - the receipt is `unknown`, "Resume lost ownership of the paused job stream.";
  - the CNC "did not confirm … no controller reset was requested" notice is raised, as H8 recorded.

### New finding

#### W2-P3-4 — found by refuter — the phone calls a CNC tool-change hold "Running" and offers a disabled Pause saying "No running job to pause."

- **Where:** `services/remote-control/app/src/ui/machine-job.tsx:90-97`. `RunningCard` shows `Paused`, `Starting`, or else `Running`. The phone's own type has `tool_change` (`app/src/core/types.ts:120`), and the desktop projects it (`machine-projections.ts:180`), but no phone UI reads it. `git grep tool_change -- services/remote-control/app/src` finds only the type.
- **Anchor:**
  - Twin: the PC's tool-change panel names the incoming bit, and Continue is gated on its Z zero (`JobRunControls.tsx:64-68`).
  - Contract: the MCP status schema's `tool_change` state (`electron/mcp/machine-schemas.ts:170`).
- **Scenario:**
  1. A two-bit CNC job started from the phone reaches its M0.
  2. The phone keeps saying "Running" with progress frozen, and its Pause is disabled with "No running job to pause." (the repro's status gives `resume` "No paused job to resume.").
  3. The operator waits for a job that is waiting for them.
  4. Nothing moves.
- **Evidence:** READ, plus the status projection captured in `toolchange.json`.
- **Severity:** P3 (misleading status, no physical effect).
- **Novelty:** not in H8, J3, R8 or v10. `git grep tool_change docs/audits` finds no phone mention.
- **Fix direction:** show "Tool change: <bit>. Change and zero it on the PC" when `job.state === 'tool_change'`. This needs a Worker redeploy (phone bundle).

### Not verified by the refuter

- The FluidNC firmware anchor was not re-fetched (see W2-P2-1). No real spindle spin-up timing was measured, and no hardware was used.
- Electron's `window.alert` blocking the renderer was not run in Electron (jsdom spy only). It is the premise of `job-aware-dialogs.ts:1-7` (H13) and was not challenged.
- The phone page itself (Playwright) was not run. The phone behaviour is READ from `app/src`, and the committed `public/app` bundle's freshness is still unverified, as the auditor noted.
- The 24 KNOWN rows were spot-read for W2-P2-1's and W2-P3-1's neighbours only. They were not re-verified one by one.

```json
[
  {"id":"W2-P2-1","severity":"P1","area":"remote-mcp-phone","file":"src/ui/remote-control/machine-projections.ts","line":126,"evidence":"REPRO","verdict":"CONFIRMED","refuter":"SEVERITY CHANGE P2->P1 (FluidNC $32=0 branch): sim FluidNC banner, remote pause/resume through the real adapter; PC advisory = CNC_RESUME_FLUIDNC_ADVISORY_MESSAGE, remote status resume {available:true} with no spin-up text, '~' sent, stream resumes; no Start-time spinup_ms warning; effect class per M3-P3-5, reach per J3-P2-3. GRBL $32=1/unknown branches warned at Start (P2). Firmware anchor inherited from D4-P2-2/M5, not re-fetched"},
  {"id":"W2-P3-1","severity":"P3","area":"remote-mcp-phone","file":"src/ui/laser/start-job-authorization-reporting.ts","line":42,"evidence":"REPRO","verdict":"CONFIRMED","refuter":"window.alert once on a refused remote Start with no job active; cannot occur while a job runs (jobAwareAlert toasts for all 5 active statuses), remote Start during a job refuses earlier, assertVacant gives busy to both phones during review and pending startJob, prefix case toasts until the port is closed"},
  {"id":"W2-P3-2","severity":"P3","area":"remote-mcp-phone","file":"src/ui/remote-control/machine-execution.ts","line":167,"evidence":"REPRO","verdict":"CONFIRMED","refuter":"refused Start and review-during-job both return 'This information is not currently available.'"},
  {"id":"W2-P3-3","severity":"P3","area":"remote-mcp-phone","file":"services/remote-control/src/protocol.ts","line":15,"evidence":"READ","verdict":"CONFIRMED","refuter":"lease fixed at approval, never renewed, no expiry in app/src"},
  {"id":"W2-P3-4","severity":"P3","area":"remote-mcp-phone","file":"services/remote-control/app/src/ui/machine-job.tsx","line":97,"anchor":"Twin: PC tool-change panel (JobRunControls.tsx:64-68); Contract: MCP status state tool_change (machine-schemas.ts:170)","evidence":"READ","verdict":"found by refuter","known":false,"summary":"The phone shows 'Running' with a disabled Pause ('No running job to pause.') during a CNC tool-change hold; tool_change is projected but never displayed"}
]
```

Refuter counts: raised 5, refuted 0, P1 1, P2 0, P3 4, known 24
