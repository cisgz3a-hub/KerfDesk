# Rolling audit v3 — App shell, licensing and remote

- **When:** 2026-10-27   **Tree:** origin/main @ `9a2bf6b13` (the audit worktree's source under `src`,
  `electron` and `services` is identical: `git diff 9a2bf6b13 HEAD -- src electron services` is empty)
- **Scope:**
  - Paths: `src/ui/app`, `src/ui/common`, `src/ui/help`, `src/ui/licensing`, `src/ui/recent-projects`,
    `src/ui/remote-control`, `services/remote-control`, `electron/mcp`, and the changed `electron/**`
    files outside the camera bridge (licensing, `main.ts`, `remote-access/**`,
    `platform-manual-update.ts`). Followed into `src/ui/remote-access`, `src/ui/laser/board-capture`,
    `src/ui/state/laser-*` only to trace the remote and crash paths.
  - Merges: 30 first-parent merges touched the paths since 2026-10-21. Read in full: #1347
    (ADR-657), #1364 (ADR-546 Amd 2), #1408 (ADR-592 Amd 3), #1439 (ADR-585 Amd 1), #1362 (ADR-654
    remote board tools), #1351 (remote import and budget fixes), #1335/#1337 (ADR-623 Amd 3),
    #1346's licensing policy, #1425/#1427 (recent projects).
  - Governing: PROJECT.md non-negotiable 9, ADR-569, ADR-585 (+Amd 1), ADR-654 item 8, ADR-657,
    ADR-546 Amd 2, ADR-592 Amd 3, ADR-623 Amd 2–3, ADR-540 Amd 5–6.
- **Lenses run:** L8 (siblings, conflicts, claims), L5 (phone, relay and MCP input), L6 (crash and
  revocation failure paths). L1–L4 and L7 were not run as separate passes. No hardware was operated,
  no production service was contacted.
- **Counts:** 3 raised → 0 refuted → P1 1 / P2 0 / P3 2 (+3 KNOWN)
- **Refuter (2026-10-27, fresh context):** 3 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED; the 3 KNOWN items
  still hold. Severity change: G7-P3-1 P3 → P1 (ID kept for traceability). G7-P3-2 and G7-P3-3 stay
  P3. Own repros `zz-g7r-*` (three focused Vitest files: the real `BoardCapturePanel` with the real
  remote adapter and registry; the real `ErrorBoundary` with `machineSoftwareAbort` and the real
  Ctrl+. listener; the real `useRemoteAccess`/`RemoteRendererSession` under an `app:` URL) were run
  with `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run <file>`,
  then deleted.
  - **Why G7-P3-1 is P1.** The auditor kept it at P3 because "Frame before Start shows the real
    path". Under §3 (2026-10-27) the Frame is not a warning. A capture taken while the head moves
    makes a wrong board, and that is wrong physical output (position). Nothing in the app names that
    mismatch for errors under the 5 mm off-square threshold (rectangles) or for perpendicular errors
    (outlines).
  - **The one open reach question is for the coordinator.** The phone app has no board control, so
    the route is MCP through the relay. Desktop 1.0.22 and 1.0.23 contain #1362, but whether the
    production relay does is not observed (the same manual redeploy as G7-K-3).

## Headline

The four hotspot fixes hold on the paths they patched and on most siblings. These all hold:

- Remote Zero Z and Set origin keep the PC guards. Every other XY origin writer already sets Start
  from.
- The relay passes through only refusals the desktop makes before it dispatches.
- A revocation that cannot be saved fails closed.
- One hold release sends one Cancel.
- Ctrl+. listens in the capture phase in the only window and the only document the app has.
- The nonce revert removes nothing ADR-623 Amendment 2 still relies on.

What slipped is in the newest code. The phone/MCP `capture_board_point` (ADR-654, #1362) skips the
gate that disables the PC's Capture button, so a board point can be recorded while another owner's
jog, Frame, Home or job is moving the head. The #1364 crash screen decides once, when it first
draws, whether to offer ABORT, so motion that starts after the crash has no on-screen stop. The
same boundary also unmounts the phone/MCP session, so a phone-started job keeps running with no
phone Abort.

No licence bypass and no remotely reachable security hole was found.

*(Refuter: the board capture is P1, not P3. With the real panel, a capture during another owner's
jog turned a 100 × 50 mm board into 100 × 54 mm with no warning. A moving second outline capture
turned the board 1.9° and moved its G92 corner 6.7 mm, with no notice. The two crash findings stay
P3, because a desktop stop stays reachable: Ctrl+. and a one-click ABORT.)*

## Findings

### G7-P3-1 (P1 after refuter) — Remote `capture_board_point` skips the PC Capture gate and records a moving head's position
- **Where:**
  - Remote path: `src/ui/remote-control/machine-actions.ts:162-181` (`executeBoardAction` checks
    only Pro, panel busy, committed, coordinate epochs and capture count). It calls
    `src/ui/laser/board-capture/use-board-remote-registration.ts:38-50` (`captureRemotePoint`), which
    calls `handlers.captureNow()`.
  - `src/ui/laser/board-capture/use-board-capture-handlers.ts:102-142`: `captureNow` checks only
    `capturingRef` and `livePosition !== null`. `capturePoint` writes G92 only for the first point,
    so later points reach `capture.capture(livePosition, epoch)` with no machine-state check.
  - `livePosition` is the last reported position in any controller state
    (`BoardCapturePanel.tsx:146-151` → `inferCurrentMachinePosition`).
  - The registry's `assertVacant` (`machine-control-registry.ts:180-192`) refuses only while the
    caller's own remote operations are unsettled, and never for a committed job.
- **Anchor:**
  - Twin: the PC Capture button is disabled by `useCaptureGating`
    (`src/ui/laser/board-capture/use-capture-gating.ts:4-22`, wired at `BoardCapturePanel.tsx:80`).
    That gate refuses when not connected, during autofocus, with pending writes, and whenever
    `jogFrameCommandBlockMessage` refuses: an active job, a motion or controller operation, MPG, an
    unknown status, or a state other than Idle.
  - Contract: ADR-654 item 8 gives MCP "capture and register" as the panel's own capture. The tool
    text says "same as Capture on the computer" (`electron/mcp/machine-tool-info.ts:60`). ADR-657
    states the principle that remote control keeps the PC's guards.
- **Scenario:**
  1. Place Board is open with a rectangle capture in progress.
  2. The PC operator jogs, runs Move to captured point, or Homes, or a job (including a
     phone-started one) is streaming.
  3. A phone or MCP client with control approval sends `capture_board_point`.
  4. The PC's Capture button is disabled at that moment. The remote capture records the
     mid-motion position as the next corner and replies "Captured point 2 of 4."
  5. The board then fits through a wrong point, and artwork placed with `place_on_board` lands
     off the physical board.

  Frame before Start shows the real path, and ADR-654 asks the operator to check every anchor, so
  this is not silent output. *(Refuter: superseded. The Frame is not a warning under §3 (2026-10-27),
  and ADR-654 item 7 says checking is not a Start gate; see the Refuter line.)*
- **Evidence:** REPRO + READ.
  - Command:
    `node ../../../node_modules/vitest/vitest.mjs run src/ui/remote-control/zz-g7-board-gating.test.ts --silent=false --reporter=verbose`.
    The test used the real adapter and registry, a registered board controller, and a laser store
    with another owner's jog (`motionOperation` jog, status `Jog`).
  - Output:
    `G7-BOARD {"pcGate":"A jog or frame operation is active. Wait for GRBL to report Idle, or cancel the operation, before sending another motion command.","code":"ok","captureCalls":1,"receipt":{…"kind":"board","state":"completed",…"committed":true,"message":"Captured point 1 of 4."}}`
  - The real panel's `captureNow` having no state check for non-first points is READ.
- **Refuter:** **CONFIRMED (REPRO, real panel); severity P3 → P1.**
  - **What would make it false:**
    - a guard after the first point;
    - the corner not feeding placement or the origin;
    - a specific warning.

    None exists:
    - `boardActionBlockMessage` checks only busy, committed, coordinate epochs and the count.
    - `assertVacant` skips committed jobs and never sees motion the PC owns.
    - `captureNow` checks only `capturingRef` and `livePosition`.
    - Only the first rectangle or marked-centre capture goes through `setOriginHere` →
      `assertOriginActionReady`.
    - Outline boards write no origin until finish, so neither of their two captures is gated.
  - **Repro, rectangle:** `zz-g7r-board-remote`, using the real `BoardCapturePanel` with the real
    adapter and registry.
    - The PC captured three corners of a 100 × 50 board at Idle.
    - A PC jog was then live (`motionOperation` jog, status `Jog`, head 4 mm past the last corner),
      and remote `capture_board_point` and `finish_board` were sent.
    - Output: `{"pcDisabled":true,"capture":"completed","captureMsg":"Captured point 4 of 4.","warnShown":false,"measured":"Board: 100.0 × 54.0 mm","finish":"completed","finishMsg":"Board created. Check every anchor on the computer, then Frame before Start.","boardSpec":{"kind":"rect","widthMm":100,"heightMm":54,"cornerRadiusMm":0}}`.
  - **Repro, outline:** same file, with the real `outlineGeometryFromCaptures`.
    - The board is 300 × 200. The second capture is 12 mm off, square to A→B, because the head is
      still moving.
    - Scale is 1.0006, so there is no 1 % notice, and it is far from the 5 % refusal.
    - Rotation is −1.9°.
    - The G92 front-left corner moves from (20, 20) to (13.3, 20).
  - **Wrong physical output: yes.**
    - The captured outline is what `place_on_board` (centre, fit, array) and the ADR-327 anchors
      place artwork against.
    - For outline boards, finish writes the G92 at the computed corner, and artwork on the board
      turns with the measured angle (ADR-654 items 5–6).
    - So the burn lands off the physical board. In the repros: 2 mm off centre for the rectangle;
      for the outline, a 6.7 mm origin shift and up to 12 mm at the far anchor.
  - **No specific warning reaches the operator:**
    - The off-square note shows only above 5 mm, only on the PC panel, and only between the fourth
      capture and finish. Remote `finish_board` does not check it, and the repro's 4 mm error showed
      nothing.
    - The outline scale notice misses errors square to A→B.
    - The receipts say "Captured point n of m" and a generic "Check every anchor … Frame before
      Start".
    - ADR-654 item 7: verification is "Neither … a Start gate".
  - **Reach:**
    - MCP only. The phone app (`services/remote-control/app/src`) has no board control.
    - Main's MCP catalogue and the relay allowlist carry the tool (`MCP_CONTROL_COMMANDS`,
      `relay.test.mjs:70`).
    - Desktop 1.0.22 (`b9202d5aa`) and 1.0.23 (`87ecb4f24`) contain #1362 (`7bcb444f6`).
    - It needs motion that the remote registry does not own at the moment of capture: a PC jog,
      Frame or Home, an MPG, or the client's own committed job. The last is deterministic:
      `start_job`, then `capture_board_point`.
    - The client's own `jog_machine` settles only at Idle (`settledMachineMotion`), so the client
      cannot race its own jog.
  - **Not lowered.** §3 has no reach clause. The production relay's version is not observed. If the
    coordinator finds that it predates #1362, the defect is latent until the redeploy G7-K-3 already
    needs, so fix it before that redeploy.
- **Fix direction:** Refuse remote capture and finish with the same `useCaptureGating` reason, by
  exposing it in `remoteBoardStatus` and checking it in `boardActionBlockMessage`. Or move the
  `jogFrameCommandBlockMessage` check into `captureNow`, so both paths share it.

### G7-P3-2 — The crash screen decides once whether to offer ABORT; motion that starts after the crash gets no on-screen stop
- **Where:**
  - `src/ui/common/ErrorBoundary.tsx:110`: `showSoftwareAbort = props.softwareAbort?.isMotionLive()`
    is evaluated when `CrashScreen` renders. The class boundary subscribes to no store, so it never
    re-renders when the machine state changes. `CrashSaveButton` (`:193`) freezes its need the same
    way.
  - `src/ui/app/crash-recovery.tsx:22-30`: `isMotionLive` is false while a Frame or Start is still
    preparing.
  - Frame preparation is a promise chain outside React (`src/ui/laser/use-frame-action.ts:100-137`),
    so it carries on after the workspace unmounts and then dispatches motion.
  - The crash screen is a full-window overlay (`ErrorBoundary.tsx` `overlayStyle`: fixed, inset 0,
    z-index 9999). The Live Motion bar is inside the crashed workspace.
- **Anchor:**
  - Contract: PROJECT.md:465, non-negotiable 9: the software Abort "is reachable from any window
    state during a job. No modal can block it".
  - Twin: the keyboard Abort re-reads the store at each key press (`use-job-shortcuts.ts`
    `stopShortcutAction`). The crash screen's ABORT does not re-read it.
- **Scenario:**
  1. The operator clicks Frame on a large design, and exact-frame preparation runs in the
     background.
  2. A render bug in any workspace panel throws, and the crash screen appears with no ABORT,
     because nothing is moving yet.
  3. Preparation finishes and the head starts tracing the Frame. The same happens for any job or
     motion that becomes live after the first render.
  4. No mouse control stops it.
  5. In the workspace boundary, Ctrl+. still works once motion is live (AppProtections). If the
     root boundary in `main.tsx` caught the crash, Ctrl+. is gone too, because AppProtections is
     inside it.

  This needs a separate render bug at that moment, so it is latent.
- **Evidence:** REPRO.
  - Command: `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run src/ui/app/zz-g7-crash-abort.test.tsx --silent=false --reporter=verbose`.
    The test used the real `ErrorBoundary` with the real `machineSoftwareAbort`, crashed the child
    while idle, then set a live `motionOperation`.
  - Output: `G7-CRASH-ABORT {"before":{"live":false,"abortButtons":0},"after":{"live":true,"abortButtons":0}}`.
- **Refuter:** **CONFIRMED (REPRO); stays P3.**
  - **What would make it false:**
    - the crash screen re-rendering when the machine state changes;
    - no way for motion to start after the crash.

    Neither holds. `App` subscribes to no store, and `CrashScreenHosts` re-render only themselves.
  - **Motion can start after the crash in one real way: a Frame whose preparation is in flight.**
    - Its only cancel, `cancelOwnedFramePreparation`, is the `JobActionControls` button inside the
      crashed workspace.
    - `isMotionLive` and the Ctrl+. action both ignore Frame preparation.
    - The desktop Start after Job Review's confirm has a short async gap too.
  - **Motion cannot start after the crash from:**
    - the keyboard Start, because `useStartShortcut` is in `WorkspaceLifecycle`;
    - a phone or MCP Frame or Start. `session.stop()` disposes the registry, `cancelMachineOperation`
      aborts every operation that is not committed (`machine-owned-operation.ts:50-53`), and
      `linkFrameAbort` ends its preparation. The relay is also closed (see G7-P3-3).
    - No queued-Start mechanism exists.
  - **Repro:** `zz-g7r-crash`, using the real `ErrorBoundary`, the real `machineSoftwareAbort` and the
    real `installAbortShortcut` beside the boundary. It crashed while idle, made a Frame live, then
    pressed Ctrl+., clicked Copy diagnostic, clicked Try again (the child still throwing) and
    clicked ABORT.
    - Output: `{"atCrash":0,"afterMotion":0,"ctrlDot":{"cancelJog":1,"stopJob":0},"afterCopy":1,"afterRetry":1,"abortClickStopJob":1}`.
  - **Why it stays P3: the stop stays reachable.**
    - In the workspace boundary, Ctrl+. reads the store at each key press and stopped the Frame.
    - Any click on the crash screen re-renders it, and ABORT then appears and reaches `stopJob`.
      Copy diagnostic and Try again are its only always-present buttons.
    - Under the root boundary, Ctrl+. is gone, but the one-click route still holds.
    - The Frame is beam-off.
    - Compare 27-P2-2 (P2): every protection was lost there, with no fallback. Here one button is
      late, and only when a render crash hits during the seconds of a Frame's preparation.
- **Fix direction:** Have the crash screen subscribe to the laser store, for example through a small
  function component using `useLaserStore(isMotionLive)`, so ABORT appears when motion starts. Or
  always show ABORT while a controller is connected. Re-evaluate the Save offer the same way.

### G7-P3-3 — A workspace render crash detaches the phone/MCP session; a phone-started job keeps running with no phone Abort
- **Where:**
  - `src/ui/app/App.tsx:152-154`: `useRemoteAccess()` sits in `WorkspaceLifecycle`, inside the
    #1364 workspace boundary. The comment there says "These serve the workspace's editing and go with
    it when it crashes".
  - On unmount, `RemoteRendererSession.stop()` (`src/ui/remote-access/renderer-session.ts:303-319`)
    disposes the registry and posts `detach`.
  - Main's `detach` (`electron/remote-access/routes.ts:140-145`) calls `runtime.closed()`, which
    closes the relay.
  - The registry's dispose leaves a committed job running (`cancelMachineOperation` returns early
    for committed jobs, `machine-owned-operation.ts:50-52`).
- **Anchor:**
  - Contract: ADR-569 ("Abort ingress remains available while an ordinary request is pending"; "A
    normal job already handed to the streamer retains its committed receipt and ordinary desktop run
    lifecycle").
  - Twin: #1364 moved every protection a running job relies on into `AppProtections`, outside the
    boundary (`App.tsx:167-187`). The remote Abort ingress was left inside.
  - Counter-anchor: ADR-569 also says "Remote Abort requires a working connection and is not a
    physical emergency stop."
- **Scenario:**
  1. A job is started from the phone, and the operator walks away with the phone.
  2. A render bug crashes the workspace. Since #1364 the job keeps streaming, by design.
  3. The relay connection closes, and the phone shows the PC as offline.
  4. Abort and Pause from the phone or an MCP client get `unavailable` until someone at the PC
     clicks Try again. If the bug persists, the session re-detaches.
  5. Held jogs are released, so this direction fails safe for motion. Only the remote stop is
     lost.
- **Evidence:** READ. G2 (`G2-job-state.md`, Refuted) deferred this to G7.
- **Refuter:** **CONFIRMED (REPRO + READ); stays P3.**
  - **What would make it false:** the remote session surviving a workspace crash, or main keeping the
    relay open.
  - **Repro:** `zz-g7r-remote-crash`.
    - Setup:
      - jsdom URL `app://`;
      - the real `useRemoteAccess` and `RemoteRendererSession`, laid out as in `App.tsx`
        (`WorkspaceLifecycle` inside the boundary, the Ctrl+. listener beside it);
      - `fetch` stubbed;
      - a job streaming;
      - a sibling panel throwing.
    - Output: `{"protocol":"app:","beforeCrash":["attach","poll"],"afterCrash":["detach"],"crashScreenAbortButtons":1,"ctrlDotStopJob":1}`.
  - **READ in main:**
    - `detach` → `runtime.closed()` → `RelayClient.close()` (`relay-client.ts:106-116`).
    - That clears the identity and the retry timer, so the relay does not reconnect until a new
      `attach` (Try again; `routes.ts:105-108`).
    - The relay pushes alerts only for event kinds the desktop sends (`device-live.ts`
      `liveMessage` → `notify`), so the phone gets no alert.
    - The phone shows "PC offline". Abort answers "The PC is offline. Keep KerfDesk open and the
      computer awake." (`app/src/core/transport.ts:34`).
  - **Why P3 and not P2:**
    - The PC keeps two stops. The crash screen shows ABORT, because the job was live when it
      rendered, and Ctrl+. works. The physical E-stop is unaffected.
    - ADR-569 accepts that remote Abort "requires a working connection and is not a physical
      emergency stop".
    - The phone shows the same offline state that a Wi-Fi drop gives, so it is not misleading about
      reach.
    - ADR-569's ingress clause is about a pending ordinary request, not a renderer crash.
    - It needs a render bug.
- **Fix direction:** Mount `useRemoteAccess` in `AppProtections` (the registry and session hold no
  workspace UI). Or keep a minimal machine-only session alive across a workspace crash, so `abort_job`
  and `pause_job` stay reachable. If kept as is, document it in ADR-569.

## KNOWN (cited, not re-raised)

- **G7-K-1 = 01-P2-5** (`docs/audits/2026-10-21-rolling-v2/01-remote-control.md:113`). Routine
  `jog_hold_stop` still uses the per-client Abort rate lane.
  - `services/remote-control/src/limits.ts:28-31` (`priorityCommand` → `MCP_PRIORITY_COMMANDS`).
  - `limits.ts` is unchanged since 2026-10-11.
  - Still open, awaiting the maintainer's decision (rolling-v2 LEDGER).
- **G7-K-2 = 02-P3-4** (`docs/audits/2026-10-21-rolling-v2/02-licensing.md`, P3-4). Still present.
  - A remote `update_text` returns `changedFields` built from its own patch
    (`src/ui/remote-control/writes.ts:95-105`). It does not check that the store accepted
    `upsertTextObject`.
  - #1351 added that check only for shape inserts (`writes.ts` `drawShape`, which throws `failed`
    when nothing landed). The text sibling did not get it.
- **G7-K-3 = 01-P2-3 in production** (meta v1 M2, `M2-meta-rolling-v2-p2.md:86`).
  - What the code expects: the ADR-657 decision-3 fix lives entirely in the relay. That covers
    `control-actions.ts` `refuse()`, `device.ts` `controlResponse`, and the phone and MCP App text
    for `busy`.
  - Until the Worker is redeployed, production keeps returning `unknown` for definite refusals.
  - A 1.0.22+ desktop sending `busy` to an old relay is mapped to `failed`
    (`device.ts:350-354` `Object.hasOwn(mcpErrorMessages, …)`), then to the ledger's `unknown`.
    That is the pre-fix behaviour, not a break.
  - The same redeploy gates the #1362 board tools for MCP clients.
  - The deployment state was not observed (no production contact).

*Refuter: all three still hold. Each was re-read on this tree; nothing was re-run.*
- *K-1:*
  - `MCP_PRIORITY_COMMANDS` is still `abort_job` plus `jog_hold_stop` (`electron/mcp/input-schemas.ts:170`).
  - `limits.ts` was last changed in `22868ee92` (2026-10-11).
  - LEDGER row 76 still says it awaits the maintainer.
- *K-2:*
  - `writes.ts:95-105` still returns `changedFields` without checking that the store accepted the edit.
  - Only `drawShape` throws `failed`.
- *K-3:* `device.ts:350-354` still maps a code it does not know to `failed`.
- *Open PRs:* none are open (`gh pr list --state open`, 2026-10-27), so no fix is in flight.

## Refuted

Candidates the auditor dropped while checking:

- **The relay tombstones a refusal that followed dispatch.** Every `stale_revision`, `busy`,
  `not_found` and `request_conflict` the desktop returns is thrown synchronously in
  `MachineControlRegistry.execute` before `schedule()`. Asynchronous failures are written onto the
  receipt (`recordMachineOperationFailure`) and never become an error reply, so ADR-657 decision 3
  only sees pre-dispatch codes.
- **Old relay plus new desktop breaks on `busy`.** An unknown code becomes `failed`, then the
  ledger's `unknown` receipt. The desktop socket is not closed.
- **Set origin siblings skip ADR-327 item 4.**
  - The No-homing guide sets `verified-origin` (`NoHomingPositionGuide.tsx:213-219`).
  - Board capture sets `user-origin` (`board-capture-actions.ts:38,43`).
  - The Start-blocked Set origin offer exists only to satisfy a User or Verified origin mode.
- **Remote Zero Z in a tool-change hold bypasses ADR-657.** Entering a hold voids the prior tool's
  Z0 evidence, so `liveZeroZOverwriteWarning` is null on the PC and on the remote alike. The
  touch-off is intended.
- **Remote jog, Home and Resume twins.**
  - Remote jog uses the store `jog` with the no-go zone guard, and the settled tool-change
    carve-out matches the PC jog pad (`LaserWindow.tsx:296-312`).
  - Home goes through `assertHomeReady`, which refuses during any active job.
  - Resume during a CNC lift is refused by `reentryBlockMessage`.
  - Remote Frame's `interactiveSetup: false` skips only the repair offers. The refusals stay in
    preparation.
- **#1439 drops a needed second Cancel.**
  - Abort still runs `stopJob` independently (`executeAbort`).
  - A failed first Cancel leaves the receipt terminal `unknown`, unchanged from before
    Amendment 1.
- **Ctrl+. is swallowed by another window capture listener.**
  - `NodeEditOverlay` returns early on Ctrl.
  - The canvas text lifecycle listens to `pointerdown`.
  - The startup splash blocks keys only in a renderer that has just started, which owns no job.
  - The only iframe is the print frame.
  - There is one BrowserWindow, and `DESKTOP_LICENCE_WINDOW` is false.
  - No raw `window.confirm`/`alert`/`prompt` exists outside `job-aware-dialogs.ts`.
- **Crash Save cannot open its dialog.** Project Save uses `ProjectSaveDialog`, which
  `CrashScreenHosts` mounts. Desktop close uses main's native dialog and `saveProjectNow`.
- **`place_on_board` array makes unbounded copies.** `planBoardArray` caps at
  `MAX_TILE_PER_AXIS`/`MAX_TILE_TOTAL`, and `refuseSceneLimitOverrun` refuses the whole array.
- **Recent projects' conditional-update loop can spin forever.** A refused compare returns the
  primary's current list (`recent-project-storage.ts` `updateIfUnchanged`), so the next pass
  matches unless another window writes again. Only two `RecentFileRef` kinds exist, and both are
  compared.
- **The tapered-inlay Pro policy disagrees with the compiler.** Both use
  `cutType === 'inlay-pair' && taperedInlay !== undefined` (`pro-operation-policy.ts`,
  `compile-cnc-operation-groups.ts:38`, `collect-cnc-contours.ts:43`).
- **#1408 removes a protection still relied on.**
  - The paid replay is accepted by ADR-623 Amendment 2.
  - The trial replay is 02-P3-1, closed by Amendment 3's withdrawal.
  - The service change is comment-only.
  - `verifyEntitlement` ignores the extra `refreshNonce` claim, so grants saved by 1.0.21/22 still
    verify.

## Verified clean

- **ADR-657 (#1347).**
  - `executeOrigin` refuses before writing when `liveZeroZOverwriteWarning` is not null.
  - XY calls `placementAfterSetOrigin` with the operation's document epoch.
  - `configure(false)`, `revoke` and `revokeAll` each `failClosed` on a save failure. That sends the
    revocation when connected, `discard()`s the record, keeps `available=false` across a renderer
    re-attach, and keeps the storage error text.
  - Later queue saves (`receiveRevocation`, `finishClientRevocations`) leave the persisted queue to
    repeat the revocation.
- **#1364.**
  - The Abort, wake lock, checkpoint, autosave, unload stop, close receiver and unsaved prompt sit
    in `AppProtections`, outside the workspace boundary.
  - Both boundaries pass `softwareAbort` and `crashSave`.
  - The only other boundary is `LazyOverlayBoundary`, under which the Live Motion bar stays mounted.
- **Merge conflicts in G7 paths since 2026-10-21.** `git show --remerge-diff` found conflicts in
  four merges, and each kept both sides:
  - `4e6e6dcda` (generated MCP App and phone bundles; both carry the `busy` text);
  - `7bcb444f6` (`machine-execution.ts`: board dispatch and the `executeOrigin` context);
  - `8f99c231a` (`writes.ts` imports and the `server.ts` result bounding);
  - `b230b1cde` (`App.tsx`: the Falcon pointer hook removed and the #1364 split kept).
- **MCP and #1362.** All five board tools check `proFeaturesUnlocked`. The tiers are:
  - `get_board` is a read;
  - `set_board_photo` and `place_on_board` are writes;
  - `capture_board_point` and `finish_board` are control, with destructive annotations.

  Photos need strict base64 and PNG/JPEG magic bytes, and are not taken while motion is active. The
  Place Board panel opens only through the gated command or the gated remote photo. `apply_edits`
  cannot carry board commands.
- **Licensing.**
  - #1337's file-open queue waits for `initialLicenceStatus()`.
  - The Pro command gate list is unchanged apart from the existing entries.
  - No new Pro feature has an ungated entry point among the menu, command, remote or file-open
    paths checked.
- **#1351 remote import.** SVG rollback ownership is kept until the enclosing commit or batch
  succeeds (`accept()` after `commit`, `dispose()` in `finally`).

## Not verified

- **The production relay Worker's version.** No production contact, so K-3's reach is unknown, and
  so is whether board tools are live for MCP clients.
- **Relay tests.** The workerd service tests and `build-app.mjs --check` were not run, because
  `services/remote-control/node_modules` is absent.
- **The real `BoardCapturePanel`.** G7-P3-1's repro used a registered stand-in controller. The real
  `captureNow` path was read. *(Refuter: since run on the real panel; see G7-P3-1.)*
- **Frame preparation after a crash.** That it continues after a workspace crash (G7-P3-2) was
  read, not run. *(Refuter: still read only. The chain has no unmount cancel. Its only cancel is
  the `JobActionControls` button.)*
- **Phone push alerts.** Whether the relay pushes an alert to a remembered phone when the PC drops
  mid-job (G7-P3-3) was not checked. *(Refuter: it does not. Alerts come only from event kinds the
  desktop sends.)*
- **A crash in a crash-screen host (refuter lead, not raised).** Both boundaries render
  `CrashScreenHosts` (`Toasts`, `DesktopCloseNotice`, `ProjectSaveDialog`) inside their fallback.
  - The workspace also mounts `Toasts` and `DesktopCloseNotice`. A render bug in one of them
    therefore throws again in the workspace fallback and reaches the root boundary.
  - The root fallback renders the same hosts. With no boundary above it, React would unmount the
    whole root: a blank window, with no ABORT and no Ctrl+.
  - Read only, and latent (it needs a render bug in those hosts). Suggested for v4 H2.
- **Ctrl+. with a Chinese IME.** Whether a Windows Chinese IME (Microsoft Pinyin's Ctrl+.
  punctuation toggle) turns Ctrl+. into a `Process` key while a text field has focus, so the
  capture listener never sees `.`, was not researched.
- **Native file pickers.** Whether Chromium/Electron native file pickers, opened during a job, make
  the main window's Abort control unclickable was not checked.
- **Image decompression bombs.** Oversized-dimension PNG/JPEG through `set_board_photo` or
  `import_file` (renderer memory) was not tested.
- **Hardware and packaging.** No hardware, real phone or packaged Electron build was used.

```json
[
  {"id":"G7-P3-1","severity":"P1","area":"app-shell-remote","file":"src/ui/remote-control/machine-actions.ts","line":171,"anchor":"Twin: src/ui/laser/board-capture/use-capture-gating.ts:4-22 (PC Capture disabled via jogFrameCommandBlockMessage); Contract: ADR-654 item 8, machine-tool-info.ts:60 'same as Capture on the computer', ADR-657 principle","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO (zz-g7r-board-remote: real BoardCapturePanel + real adapter/registry; 3 PC corners of a 100x50 board at Idle, then a PC jog live (status Jog, head 4 mm past the corner); PC Capture disabled; remote capture 'Captured point 4 of 4', no off-square warning, remote finish created a 100x54 board. Outline: second capture 12 mm off square to A->B gives scale 1.0006 (no 1% notice), rotation -1.9 deg, G92 corner (20,20)->(13.3,20)). Severity P3 -> P1: wrong position, no specific warning (off-square only >5 mm, PC-only, skipped by remote finish; Frame is not a warning, METHOD §3 2026-10-27; ADR-654 item 7 no Start gate). Reach MCP only (phone has no board control); desktop 1.0.22/1.0.23 contain #1362; production relay version unobserved: if it predates #1362 the defect is latent until the K-3 redeploy","known":false,"summary":"Remote capture_board_point skips the PC Capture gate (Idle, no motion/job/MPG, no pending writes); captureNow has no state check after the first point, so a moving head's last reported position becomes a board corner and the receipt says 'Captured point n of 4'"},
  {"id":"G7-P3-2","severity":"P3","area":"app-shell-remote","file":"src/ui/common/ErrorBoundary.tsx","line":110,"anchor":"Contract: PROJECT.md:465 non-negotiable 9; Twin: use-job-shortcuts.ts stopShortcutAction reads the store per key press","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO (zz-g7r-crash: real ErrorBoundary + machineSoftwareAbort + installAbortShortcut; crash idle, Frame live -> 0 ABORT; Ctrl+. -> cancelJog; Copy diagnostic or Try again -> ABORT shown, click -> stopJob). Only an in-flight Frame preparation (its cancel lives in the crashed workspace) or the short post-confirm Start gap goes live after the crash; keyboard Start unmounted, remote Frame/Start cancelled by registry dispose. Stays P3: stop reachable by Ctrl+. (workspace boundary) and one click on the crash screen; Frame is beam-off","known":false,"summary":"Crash screen evaluates isMotionLive once at first render; a Frame or job that becomes live after the crash (preparation runs outside React) shows no ABORT button; under the root boundary Ctrl+. is gone too"},
  {"id":"G7-P3-3","severity":"P3","area":"app-shell-remote","file":"src/ui/app/App.tsx","line":154,"anchor":"Contract: ADR-569 Abort ingress remains available; Twin: #1364 AppProtections keeps every other running-job protection outside the boundary","evidence":"READ; refuter REPRO","verdict":"CONFIRMED","refuter":"REPRO (zz-g7r-remote-crash: app: URL, real useRemoteAccess/RemoteRendererSession in the App.tsx layout, job streaming; before crash attach+poll, after crash detach; crash screen ABORT shown; Ctrl+. -> stopJob) + READ (routes.ts detach -> runtime.closed -> RelayClient.close clears identity and retry; no push alert on desktop drop; phone shows PC offline). Stays P3: PC ABORT and Ctrl+. remain, physical E-stop unaffected, ADR-569 'Remote Abort requires a working connection and is not a physical emergency stop', same offline state as a Wi-Fi drop","known":false,"summary":"useRemoteAccess sits inside the workspace error boundary; a render crash stops the renderer session, main closes the relay, and a phone-started job keeps running with phone/MCP Abort and Pause unavailable until Try again"},
  {"id":"G7-K-1","severity":"P2","area":"app-shell-remote","file":"services/remote-control/src/limits.ts","line":28,"anchor":"Twin: control-actions.ts usesAbortReserve","evidence":"READ","verdict":"KNOWN","refuter":"holds: MCP_PRIORITY_COMMANDS still abort_job + jog_hold_stop (input-schemas.ts:170); limits.ts unchanged since 22868ee92; LEDGER row 76 awaiting decision","known":"docs/audits/2026-10-21-rolling-v2/01-remote-control.md 01-P2-5","summary":"Routine jog_hold_stop still spends the per-client Abort rate lane; awaiting the maintainer decision"},
  {"id":"G7-K-2","severity":"P3","area":"app-shell-remote","file":"src/ui/remote-control/writes.ts","line":95,"anchor":"Twin: writes.ts drawShape verifies insertion (#1351)","evidence":"READ","verdict":"KNOWN","refuter":"holds: writes.ts:95-105 unchanged; only drawShape throws failed","known":"docs/audits/2026-10-21-rolling-v2/02-licensing.md 02-P3-4","summary":"Remote update_text still reports changedFields without checking the store accepted the edit; #1351 fixed only the shape-insert sibling"},
  {"id":"G7-K-3","severity":"P2","area":"app-shell-remote","file":"services/remote-control/src/device.ts","line":140,"anchor":"Contract: ADR-657 decision 3","evidence":"READ","verdict":"KNOWN","refuter":"holds: device.ts:350-354 maps unknown codes to failed; deployment still unobserved","known":"docs/audits/2026-10-23-meta-v1/M2-meta-rolling-v2-p2.md:86 (01-P2-3 production effect needs relay redeploy)","summary":"The 01-P2-3 fix lives entirely in the relay; until the Worker is redeployed production still returns unknown for definite refusals (desktop busy maps to failed then unknown); deployment state not observed"}
]
```
