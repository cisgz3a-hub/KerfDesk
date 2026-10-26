# Rolling audit v2 — Remote control (phone and MCP)

- **When:** 2026-10-21 13:20–15:10 (+08:00)   **Tree:** origin/main @ `70c01e11f`
- **Scope:** `services/remote-control/**` (Worker + Durable Object relay, React phone/MCP app, legacy
  `/control` page), `electron/remote-access/**`, `electron/mcp/*-schemas.ts` + `input-schemas.ts` + `server.ts`
  (shared command contract), `src/ui/remote-access/**`, `src/ui/remote-control/**`, and the canonical desktop
  paths the remote calls (`start-job-flow.ts`, `use-frame-action.ts`, `laser-jog-actions.ts`,
  `laser-motion-cancel*.ts`, `laser-origin-actions.ts`, job-review store/presentation). Governing: ADR-564,
  ADR-565, ADR-568 (+Amd 1), ADR-569 (+Amd 1, Amd 2), ADR-582, ADR-583, ADR-584, ADR-585, ADR-597,
  PROJECT.md non-negotiable 21 and the "Approved remote access" paragraph, ADR-327 item 4.
- **Lenses run:** L1, L2, L3, L4, L5 (relay and desktop as separate passes), L6, L7 — all seven, as six
  independent parallel passes, then four independent refuters. The workerd service tests could not run
  (`services/remote-control/node_modules` is absent; no install per the brief); relay behaviour was reproduced
  by driving the real `RemoteDevice` class with a stubbed `cloudflare:workers` and fake storage, and the
  OAuth library from its published 1.2.1 dist.
- **Counts:** 23 raised → 5 refuted (listed below, incl. one partially) → **P1 0 / P2 6 / P3 17** (+ 0 KNOWN).
  The machine-cluster refuter (R1) did not return a written verdict; its own scratch tests for P2-1 and P2-2
  were re-run by the auditor and reproduce both. Its other candidates (P2-6, P3-15..17) are marked PLAUSIBLE.

## Headline

No P1. Pairing, the cookie session, OAuth audience/scope binding, relay isolation between computers and
clients, the durable action ledger, the separate view/edit/control tiers on both relay and desktop, the
artwork-sharing opt-in and the frame-first, exact-reviewed-program Start all hold. Remote Start calls the same
`runFramedPermitStart` as the PC button, and Abort jumps every queue. The real problems are twins where the
remote calls a raw store action that the PC wraps with a guard: remote **Zero Z** skips the PC's
overwrite-the-probed-zero confirmation (wrong cut depth), and remote **Set origin** skips the Absolute → User
Origin switch (job still runs at the drawn bed position). Two more matter for trust: a failed encrypted save
during **Disable/Revoke** loses the revocation and revoked phones regain control on the next launch, and
the relay turns every definite desktop refusal of a machine command into "outcome unconfirmed — do not retry".

## Findings

### P2-1 — Remote Zero Z skips the PC's overwrite guard and silently replaces a probed work Z0
- **Where:** `src/ui/remote-control/machine-actions.ts:138` (`executeOrigin` calls `zeroZHere()` directly);
  phone button `services/remote-control/app/src/ui/MachineScreen.tsx:154-160` sends with no confirmation.
- **Anchor:** Twin — PC handler `src/ui/laser/use-zero-z-action.ts:18-29` runs `zeroZOverwriteWarning`
  (`src/ui/laser/zero-z-guard.ts:21-38`), whose purpose is to stop "a parked-height click … silently moving
  work Z0 into the air". The store action has no guard of its own; the MCP tool text says it uses "the
  ordinary desktop action". No ADR exempts the remote (ADR-585 names only `zeroZHere()`).
- **Scenario:** CNC operator probes Z on the PC; the probe retracts the bit 20 mm. On the phone they tap
  Zero Z. The remote writes `G54 G92 Z0` with no warning, replaces the probe evidence with `manual-zero`, and
  the next job cuts 20 mm in the air (or too deep if the bit was below zero). Frame (tool-off, XY) does not
  reveal it. `get_machine_status` reports `availability.origin = available`, so the phone gets no hint.
- **Evidence:** REPRO — refuter test re-run by the auditor:
  `node …/vitest.mjs run --config scratchpad/R1/vitest.r1.config.ts origin` → 3 passed; log:
  `PC hook: confirm calls = 1 | G92 lines written = 0` vs
  `remote receipt: completed | Z zeroed here. | confirm calls = 0 | wire: ["G54 G92 Z0\n"]`,
  `evidence after: {"source":"manual-zero",…}`. Independently reproduced by lens L1M and L3T.
- **Refuter:** CONFIRMED — R1's own test (`origin.r1.test.ts`) asserts both sides on a fake GRBL connection;
  written verdict not returned. Severity borderline P1 (wrong depth), kept P2 because an operator tap is the
  trigger.
- **Fix direction:** Run `zeroZOverwriteWarning` in `executeOrigin` and refuse with a fixed message (the remote
  cannot answer a native confirm), or expose the warning in availability and require an explicit confirm arg.

### P2-2 — Remote Set origin leaves Start-from on Absolute, so Frame and Start ignore the new origin
- **Where:** `src/ui/remote-control/machine-actions.ts:139` (only `setOriginHere()`).
- **Anchor:** Contract — ADR-327 item 4 (`DECISIONS.md:20653`): "Set origin upgrades only Absolute … Start from
  changes to User Origin"; `WORKFLOW.md:4238`. Twin — `src/ui/laser/OriginRow.tsx:249-257,269-277`
  (`placementAfterSetOrigin`).
- **Scenario:** Homing machine, placement Absolute (the default). Phone user jogs to the stock corner, taps
  Set origin; receipt says "Work origin set here." `resolveAbsolute` (`src/ui/job-placement.ts:216-225`)
  compensates the new offset, so Frame and Start still run at the drawn bed position. The phone has no
  placement command, so it cannot correct it. Frame shows the real trace before any burn.
- **Evidence:** REPRO — same re-run: `remote receipt: completed | Work origin set here. | G92 sent:
  ["G54 G92 X0 Y0\n"] | startFrom after: absolute`. Also reproduced by L1M and L3T.
- **Refuter:** CONFIRMED — R1 test asserts `startFrom === 'absolute'` after a confirmed remote Set origin.
- **Fix direction:** Move the Absolute → User Origin upgrade (with its document-epoch check) into a shared
  helper and call it from `executeOrigin` after the confirmed XY set.

### P2-3 — Relay turns definite desktop refusals of machine commands into "outcome unconfirmed — do not repeat"
- **Where:** `services/remote-control/src/device.ts:141` (`controlResponse`, reached from `handleResult`
  `:336-342`); desktop pre-dispatch refusals at `src/ui/remote-control/machine-control-registry.ts:157,160-161,
  180-191,229`.
- **Anchor:** Contract — ADR-569: uncertainty is the outcome of a *lost* result; changed review facts need a
  refreshed review. Twin — the phone has dedicated text for `stale_revision`
  (`app/src/core/transport.ts:24`) and its UI fixture models a 409 (`test/machine-ui-support.mjs:43`);
  non-control writes keep their real codes.
- **Scenario:** The PC edits the design (or a jog is still settling) and the phone presses Frame / Review /
  Jog. The desktop refuses before reserving anything (`stale_revision` / `busy`). The phone gets a successful
  receipt `state:"unknown", committed:null`, "This action outcome is unconfirmed … Do not automatically repeat it
  with a new ID", then a warning toast; `get_control_operation` stays `unknown` forever and a same-ID retry is
  a ledger conflict. An MCP agent obeying the tool text stalls. Nothing moves, but the user is told the
  machine may have.
- **Evidence:** REPRO (R2, real `RemoteDevice` on fake storage, `scratchpad/R2/device-error-receipt.r2.test.ts`):
  `frame_job` answered `{type:'error',error:{code:'stale_revision'}}` → `{"operation":{"kind":"frame",
  "state":"unknown","committed":null,…}}`; `undo` with the same error keeps `stale_revision`.
- **Refuter:** CONFIRMED (R2; rated P2-low).
- **Fix direction:** Pass through codes that are definitely pre-dispatch (`stale_revision`, `invalid_input`,
  `busy` as a distinct code) and tombstone the ledger ID; keep `unknown` for `unavailable`/`failed`/
  `cancelled`/timeout, which can follow dispatch.

### P2-4 — A failed encrypted save during Disable/Revoke loses the revocation; revoked phones regain control after restart
- **Where:** `electron/remote-access/runtime.ts:306-312` (configure), `:357-366` (revoke), `:379-385`
  (revokeAll); error overwrite at `:139-142` via `relay.close()`; `opened()` reload at `:265-286`.
- **Anchor:** Contract — ADR-564: disabling access "durably queues revocation before it can reconnect".
- **Scenario:** A control phone is paired; the user turns remote access off (or revokes it). `store.write`
  rejects (Windows rename blocked by an AV/indexer lock on `%APPDATA%\…\remote-control.v1`, disk full, keyring
  fault). The runtime closes the relay but never sends `client.revoke`/`clients.revokeAll` (sent only after a
  successful save); the file still says `enabled:true`. The save error is overwritten by "The computer is
  offline. Remote access will reconnect automatically."; the toggle stays checked and disabled. On next
  launch `opened()` reconnects with the old record and the revoked phone has `canRequest(control) = true`.
  Exposure ends at lease expiry (8 h; 30 days for remembered phones and OAuth grants).
- **Evidence:** REPRO — L67 (`scratchpad/L67/runtime-persist-failure.test.ts`: `PHONE CAN CONTROL ON NEXT
  LAUNCH true`) and independently R4 with the real credential store and a real Windows `FileShare.None` lock
  (`scratchpad/R4/c7-real-store.r4.test.ts`: disk `{"enabled":true,"revokeOnConnect":false}`, next launch sends
  only `clients.list`, `canRequest(control)` true).
- **Refuter:** CONFIRMED (R4). "Revoke all connections" stays usable and could recover once storage works,
  but nothing tells the user to use it.
- **Fix direction:** Fail closed across restart (e.g. delete the credential file, which needs no safeStorage,
  or send `client.revoke`/`clients.revokeAll` before persisting when connected) and keep the real error text.

### P2-5 — Routine held-jog releases spend the per-client Abort rate allowance; remote Abort can get HTTP 429
- **Where:** `services/remote-control/src/public.ts:145` → `limits.ts:28` (`priorityCommand` covers
  `jog_hold_stop`) and `limits.ts:73` (`ABORT_LIMIT`, `wrangler.jsonc:42`: 30 per 60 s per device/client/lease);
  phone posts `jog_hold_stop` on every release (`app/src/core/held-jog.ts:55-65`; any press >250 ms is a hold,
  `machine-jog.tsx:9`).
- **Anchor:** Twin + Contract — `control-actions.ts:218-227` (`usesAbortReserve`: "Routine hold releases spend
  ordinary capacity; preserve the Abort reserve") and the 2026-10-14 audit's fix of the same twin in the ledger
  and renderer; README:93 "normal polling cannot spend the Abort lane"; ADR-569 Abort ingress stays available.
  Counter-anchor: ADR-585 says `jog_hold_stop` "uses the reserved Abort lanes on the relay and desktop".
- **Scenario:** Phone positions the head with ≥30 press-and-hold jogs within a minute, starts Frame, presses
  Abort: `abort_job` gets 429 "Too many requests" for the rest of that minute. MCP grants from the same paired
  browser share the key. Abort on the PC and the dead-man are unaffected.
- **Evidence:** REPRO (L5R, real `clientLimited`/`priorityCommand` with a fixed-window fake binding at the
  wrangler limits: `abort_job after 30 hold releases rate-limited: true`); SOURCE
  https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ ("permissive, eventually
  consistent", per location).
- **Refuter:** CONFIRMED by reading (R2). **Severity disputed:** L2G and R2 rate it P3 because ADR-585 chose
  the shared lane and the 429 is visible; the auditor keeps P2 because the maintainers' later rule (ledger and
  renderer) is that routine stops must not consume Abort capacity, and Abort is the one remote action that must
  stay available.
- **Fix direction:** Charge routine `jog_hold_stop` to `CLIENT_LIMIT`, falling back to `ABORT_LIMIT` only when
  that is exhausted (mirror `usesAbortReserve`); amend ADR-585's wording.

### P2-6 — One hold release runs Cancel twice; the superseded attempt marks the receipt "stop could not be confirmed"
- **Where:** `src/ui/remote-control/machine-control-registry.ts:120-121` (`holds.release()` already calls
  `releaseHeldMotion`, then line 121 calls it again); `machine-hold.ts:118-121` (catch sets `state='unknown'`);
  `src/ui/state/laser-motion-cancel-context.ts:65-74` (a newer attempt makes the older one throw "replaced");
  phone follower stops at the first terminal state (`app/src/core/control-operation.ts:27-29`).
- **Anchor:** Contract — ADR-569: receipts distinguish stages and observed completion. Twin — the desktop's own
  Cancel treats a replaced attempt as a non-event.
- **Scenario:** Phone holds X+ and releases (socket `hold.release` plus `jog_hold_stop`). Two `cancelJog()` run;
  the first rejects within milliseconds, so the receipt reads terminal `unknown` "The held jog stop could not be
  confirmed. Check the machine on the PC." until the second settles, then `completed | Stopped.` A phone poll
  (600 ms) that lands in that window shows a false warning on a routine release. One 0x85 is written and the
  machine stops; new motion requested in the window is refused by the store.
- **Evidence:** REPRO by two lenses with the real registry and store on a fake GRBL port (L1M
  `scratchpad/L1M/src/hold-double-cancel.test.ts`: `native cancelJog calls from ONE jog_hold_stop: 2` …
  `receipt right after first Cancel settles: {"state":"unknown",…}` … `final receipt: completed`; L67 same
  result); auditor confirmed the double call and the "replaced" throw by reading.
- **Refuter:** PLAUSIBLE — R1 wrote and ran a test (`scratchpad/R1/hold.r1.test.ts`, 3 passed) but its written
  verdict did not return. The window length on real hardware is unmeasured; drop to P3 if it is much shorter
  than the phone's poll.
- **Fix direction:** Make `releaseHeldMotion`/`cancelMachineOperation` idempotent per motion id and ignore a
  superseded-attempt rejection.

### P3 findings (one paragraph each)

- **P3-1 Job Review paging shows a false "No warnings" (CONFIRMED, R4).** `app/src/ui/machine-job.tsx:181`
  shows "No warnings for this job." whenever the *current page* has none; "Show more" replaces the page
  (`app/src/core/controller.ts:476`) and totals (`totalWarnings`) are dropped. With 30 layers × 2 summaries,
  page 2 says "No warnings" though page 1 had 2; Slide to start is enabled on any page. Twin: legacy
  `public/control-machine-view.js:224-246` shows totals. R4 rates P3 because warnings precede operations and
  are almost always seen on page 1. Fix: show totals, base the banner on `totalWarnings`.
- **P3-2 Refresh tokens have no reuse detection (CONFIRMED, R3 REPRO).** Pinned
  `@cloudflare/workers-oauth-provider` 1.2.1 accepts the previous refresh token indefinitely until its
  replacement is used and never revokes the grant on reuse (R3 ran the dist: `replay R1 again (previous token)
  -> 200`, `attacker R3 after reuse was evident -> 200 ok (grant NOT revoked)`). MCP 2026-07-28: for public
  clients servers "MUST rotate refresh tokens" per OAuth 2.1 §4.3.1 (replay detection → revoke grant). All
  CIMD clients are public here. Documented as intended in README:89; needs token theft, and re-consent revokes
  older grants, hence P3. Fix: wrap refresh to revoke on mismatch or drop the previous-token grace for public
  clients.
- **P3-3 Confidential DCR clients may skip PKCE (CONFIRMED, R3 REPRO).** Library requires PKCE only for
  `none` clients; DCR defaults to `client_secret_basic`; `oauth.ts` consent never checks for a challenge (R3:
  `authorize without PKCE -> 302 code issued`). OAuth 2.1 (§7.5.1.1 in draft-16) allows the exception only with
  an OIDC nonce; README:33 promises S256 PKCE. Fix: refuse requests without an S256 challenge.
- **P3-4 MCP consent extends an 8-hour pairing to a 30-day control lease without telling the PC (PLAUSIBLE as
  drift; breach REFUTED).** `index.ts:57` → `approvals.ts:310`; asserted by `test/machine-auth.test.mjs:246-249`.
  ADR-583 context and README:80,87 make it intended, but the PC dialog (`RemotePairingHost.tsx:84`) says
  "otherwise 8 hours" and the PC list shows no expiry. Fix: say so on the PC or amend ADR-583.
- **P3-5 A relay `clients` push briefly refuses every command, Abort included (CONFIRMED, R2 REPRO).**
  `electron/remote-access/runtime.ts:105` requires `!waitingClients`; uncorrelated pushes (`retainGrant`,
  phone sign-out, PC decline) start a re-list; for one round trip Abort/hold-stop are refused (then masked as
  `unknown`, P2-3), heartbeats dropped, and completed replies suppressed by `canReply`. Fix: serve the previous
  verified list while re-checking.
- **P3-6 One approved client can occupy all 32 per-PC slots (CONFIRMED, R2 REPRO).** `device.ts:224`,
  `mcp-requests.ts:28`; 32 parked `wait_for_change` → another client's `frame_job` gets `unavailable`. Abort
  keeps 4 slots. Fix: per-client sub-cap.
- **P3-7 GET routes bypass ingress limiting (PLAUSIBLE).** `limits.ts:46-52`: `GET /api/session`,
  `/api/pair/status`, `/authorize` are unlimited; each consent GET writes a record (64 per PC, 10 min), so an
  approved read-only phone can block other clients' MCP consent for 10 minutes (revocable). Fix: cap per
  client / limit `/authorize`.
- **P3-8 Relay reset mid-command reports "Open KerfDesk and try again" for control commands (PLAUSIBLE).**
  `services/remote-control/src/relay.ts:77` maps any RPC exception to `unavailable`; the phone treats 503 as
  ambiguous, but MCP agents and the MCP Apps panel (`app/src/core/mcp-transport.ts:29-31`) do not, inviting a
  new-ID retry after a dispatched jog. Source: Cloudflare DO lifecycle (deploy stops in-flight storage access).
  Fix: return the ledger's unknown receipt for control commands on RPC failure.
- **P3-9 Remote `save_project` of an invalid project opens a PC confirm and picker (CONFIRMED mechanism,
  latent).** `src/ui/remote-control/design-save.ts:26` → `offerSalvageExport` → native `window.confirm`; ADR-584
  says no picker opens. No current path makes a project `invalid` (R4). Fix: non-interactive remote outcome.
- **P3-10 PROJECT.md "Approved remote access" is stale (CONFIRMED).** `PROJECT.md:40` says file exchange,
  connection changes and recipe/layer creation "remain outside this phase" and Jog is discrete only; ADR-584/585
  shipped `import_file`, `create_operation`, `apply_material_recipe`, connect/disconnect, home, origin,
  pause/resume, hold-to-jog and camera. The in-app copy is current. Fix: rewrite citing ADR-582..585 and list the
  exclusions that remain (raw G-code/console, shell, arbitrary paths, laser firing, port names).
- **P3-11 Remote `update_operation` bounds differ from PC Cut Settings (CONFIRMED, R4 REPRO).**
  `electron/mcp/design-schemas.ts:64-71` allows speed 0.0001, fill interval 0.01, lines/mm 1–100, any hatch
  angle, min power > power; PC `cut-settings-draft.ts` uses 1, 0.05–10, 5–25, 0–180 and clamps min power. No
  physical effect found (compiler clamps min power). Fix: one shared bounds table.
- **P3-12 `update_operation` tool description lists four fields (CONFIRMED).** `electron/mcp/tool-info.ts:83`
  vs the ADR-584 field list.
- **P3-13 Renderer UUID regex rejects nil/max UUIDs the relay accepts (CONFIRMED, R2).**
  `src/ui/remote-control/validation.ts:36`, `machine-validation.ts:24` vs `z.uuid()`; relay consumes a ledger slot
  then the desktop refuses (masked `unknown`). Phones use `crypto.randomUUID()`.
- **P3-14 `control_required` surfaces as generic `failed` (CONFIRMED, R2 REPRO).**
  `electron/remote-access/routes.ts:66-80` has no mapping; visible on `get_camera_snapshot` races.
- **P3-15 Discrete remote Z jog accepts 100 mm (PLAUSIBLE; refuter silent).** `electron/mcp/machine-schemas.ts:67`
  bounds every axis at 100 mm; hold Z is 20 mm (ADR-585), phone UI caps Z at 10 mm, PC max Z step is 5 mm; the
  MCP Apps panel shares one Step field for XY and Z. L1M REPRO: `Z vector sent: {"dz":-100,"feed":600}`.
  Bounds are warn-only by policy, so P3.
- **P3-16 Phone "PC speed" jog option is not the PC's chosen jog speed (PLAUSIBLE; refuter silent).**
  `machine-execution.ts:126`, `machine-hold.ts:39` use fixed 3000/600 mm/min; PC uses
  `useJogControlPreferences`.
- **P3-17 No test covers the registry's dead-man arming (PLAUSIBLE; refuter silent).**
  `machine-control-registry.ts:100` (`holds.arm`) and `renderer-session.ts:295-299`; L67 showed a mutation that
  no-ops `arm` leaves `machine-hold-capacity.test.ts` green while a positive dead-man test fails. Fix: add the
  registry-level dead-man test and a renderer-session beats/releases test.

## Refuted

- **OAuth lease extension is an ADR-583 breach** — refuted: ADR-583's context and README:80,87 document that
  `offline_access` issuance extends the lease; only the PC-side disclosure gap survives (P3-4).
- **Machine reviews leak artwork text when sharing is off** (auditor seed: `review_machine_job` is missing from
  `renderer-delivery.ts` READS) — refuted: machine results are re-projected at delivery
  (`machine-control-registry.ts:319-324`) through the label-redacting `reviewMessageProjector`.
- **Dead-man release before the jog is written lets the 100 mm hold run** (auditor seed) — refuted:
  `onMotionOwner` fires before the write and canonical `runCancelJog` poisons pending manual motion
  (`laser-motion-cancel.ts:44-59`).
- **Pairing code brute force via the eventually consistent limiter** (L2G) — refuted: the Durable Object's
  strongly consistent 5-attempt counter per one-use offer is the real guard; the code carries ~71.7 bits
  (uniform; L5R sampled 240,000 symbols).
- **Exhausting the 20 phone sockets per PC** (L5R) — dropped: Cloudflare's `getWebSockets` excludes
  disconnected sockets and each client's new socket replaces its old one.
- Sub-claim corrected: `abort()` sends a hold stop first only while a hold is active (R2), not always.

## Verified clean

- **Pairing/auth:** 12-char code from a 63-symbol alphabet with rejection sampling (`security.ts:21-32`), one
  use, 5 persisted attempts, owner must be online, serialized in `blockConcurrencyWhile`; 256-bit session token
  and owner secret; `__Host-` Secure/HttpOnly/SameSite=Strict cookie with server-side expiry; every secret
  comparison via `timingSafeEqual` digests. Expiry is re-checked on dispatch, on result
  (`resultAuthorized`), on every phone frame and broadcast, on heartbeats and on push.
- **Revocation:** relay revoke removes client, consents, ledger, MCP associations, push subscription and
  sockets, releases holds and cancels pending desktop work; OAuth access/refresh re-check the DO on every call;
  desktop revoke cancels requests, aborts machine grants and releases holds (but see P2-4 for persistence
  failure).
- **Isolation:** the DO is reached only via Worker-built private requests; deviceId comes from the
  UUID-validated cookie or encrypted OAuth props; ledger, receipts and MCP associations are keyed by client
  and lease.
- **Tiers:** one classification (`input-schemas.ts:92-150`) enforced at the relay (`device.ts:246`), Electron
  main (`relay-client.ts:63,142-151`, `renderer-queue.ts:89-93`) and renderer (`canWrite`, machine grants,
  `machine-camera.ts`); read commands reach no motion, connection, camera, Frame or Start code; PC approval
  checkboxes for edit, control and remember start unchecked; the control text names Jog, Frame, Start and Abort
  and their physical effect.
- **Sharing opt-in:** preview, scene, text, camera and review messages check sharing before and after async
  work; turning it off aborts in-flight reads; operation names are generic when off.
- **Start contract:** remote Start is `runFramedPermitStart` with the same readiness check, review, rebind,
  one-use claim and authorization as the PC; approval requires same revision, owner, open review, no
  preparation/blocker/card edit and the identical model object; the gate re-prepares and compares bytes at
  confirm; a second confirm is `not_found`; another client cannot confirm. No licence check in the path.
- **Abort:** priority in main and renderer queues, no revision, skips the busy check, reserved ledger
  capacity, canonical `stopJob`; receipt `completed` only on a fresh Idle report.
- **Hold-to-jog:** refused without `jogCancel`; travel bounded at 100/20 mm at the clamped feed; heartbeats
  forwarded only for clients with a live control lease; relay loss releases every hold; cancels target only
  the owned motion on the same controller session.
- **Ground truth:** DO hibernation does not drop live `pending`/waiters (timers and in-flight RPC keep it
  resident); `transactionSync` + `sync()` + output gates satisfy "durably reserve before dispatch"; RFC 6455
  Origin is checked on the phone socket; Web Push matches RFC 8291's example vector (L2G REPRO) and RFC 8292
  VAPID; GRBL 0x85 semantics match the dead-man design.
- **Focused tests run (all passing):** renderer-queue 7, runtime 23, runtime-control-lease 11,
  renderer-session 13, machine-hold 5, machine-hold-capacity 2, renderer-machine-authority 6,
  renderer-machine-priority 1, machine-review 7, machine-review-revision-window 7, prepared-job-review 18,
  renderer-artwork-sharing 9, machine-privacy 4, machine-execution 12, machine-owned-cancellation 3,
  machine-control 8.

## Not verified

- Workerd service tests (no `services/remote-control/node_modules`); relay behaviour was reproduced on a
  stubbed DO instead. Live Cloudflare limiter behaviour and a real deploy-time DO reset (P3-8).
- The machine-cluster refuter's written verdicts (P2-6, P3-15..17 are therefore PLAUSIBLE).
- Real-hardware timing of the P2-6 window and of heartbeats; no hardware was operated.
- Which auth method hosted ChatGPT/Claude connectors register with (affects P3-2/P3-3 reach).
- Every Job Review warning generator against the label-redaction heuristic (sampled only).
- `build-app.mjs --check` freshness of the generated phone/MCP bundles (CI runs it on every PR).
- Design question for the maintainer, not raised: the desktop's permission check uses the relay's client
  list (it keeps no local copy of approved scopes), so it is not independent of the relay.

```json
[
  {"id":"P2-1","severity":"P2","area":"remote-control","file":"src/ui/remote-control/machine-actions.ts","line":138,"anchor":"Twin: src/ui/laser/use-zero-z-action.ts:18-29 zeroZOverwriteWarning","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Remote Zero Z skips the PC overwrite guard and silently replaces a probed work Z0 (wrong cut depth)"},
  {"id":"P2-2","severity":"P2","area":"remote-control","file":"src/ui/remote-control/machine-actions.ts","line":139,"anchor":"Contract: ADR-327 item 4; Twin: src/ui/laser/OriginRow.tsx:249-257","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Remote Set origin leaves Start-from on Absolute, so Frame/Start ignore the new origin"},
  {"id":"P2-3","severity":"P2","area":"remote-control","file":"services/remote-control/src/device.ts","line":141,"anchor":"Contract: ADR-569 (uncertainty only for a lost result); Twin: app transport stale_revision text","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Relay turns definite desktop refusals of machine commands into 'outcome unconfirmed - do not repeat' receipts"},
  {"id":"P2-4","severity":"P2","area":"remote-control","file":"electron/remote-access/runtime.ts","line":306,"anchor":"Contract: ADR-564 'durably queues revocation before it can reconnect'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Failed encrypted save during Disable/Revoke loses the revocation; revoked phones regain control on next launch; error text says it will reconnect"},
  {"id":"P2-5","severity":"P2","area":"remote-control","file":"services/remote-control/src/public.ts","line":145,"anchor":"Twin: control-actions.ts usesAbortReserve; Contract: ADR-569 Abort availability, README:93 (ADR-585 counter-anchor)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Routine jog_hold_stop releases spend the 30/min per-client Abort rate allowance; remote Abort can get 429 (severity disputed: P3 by two assessors)"},
  {"id":"P2-6","severity":"P2","area":"remote-control","file":"src/ui/remote-control/machine-control-registry.ts","line":121,"anchor":"Contract: ADR-569 truthful receipts; Twin: desktop Cancel treats replaced attempt as non-event","evidence":"REPRO","verdict":"PLAUSIBLE","known":false,"summary":"One hold release runs cancelJog twice; superseded attempt marks the receipt 'stop could not be confirmed' until the second settles"},
  {"id":"P3-1","severity":"P3","area":"remote-control","file":"services/remote-control/app/src/ui/machine-job.tsx","line":181,"anchor":"Twin: public/control-machine-view.js totals; Contract: ADR-569 canonical review shown","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Job Review 'Show more' page says 'No warnings for this job' though earlier page had warnings; totals dropped"},
  {"id":"P3-2","severity":"P3","area":"remote-control","file":"services/remote-control/src/index.ts","line":54,"anchor":"Ground truth: MCP 2026-07-28 security considerations; OAuth 2.1 4.3.1; RFC 9700 2.2.2","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"OAuth provider 1.2.1 keeps previous refresh token valid and never revokes the grant on reuse"},
  {"id":"P3-3","severity":"P3","area":"remote-control","file":"services/remote-control/src/oauth.ts","line":45,"anchor":"Ground truth: OAuth 2.1 PKCE enforcement; README:33","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Confidential DCR clients can complete authorization without PKCE"},
  {"id":"P3-4","severity":"P3","area":"remote-control","file":"services/remote-control/src/approvals.ts","line":310,"anchor":"Contract: ADR-583 'longer session is the operator's explicit choice' vs PC dialog RemotePairingHost.tsx:84","evidence":"READ","verdict":"PLAUSIBLE","known":false,"summary":"MCP consent extends an 8-hour pairing (incl. control) to 30 days with no PC-side disclosure"},
  {"id":"P3-5","severity":"P3","area":"remote-control","file":"electron/remote-access/runtime.ts","line":105,"anchor":"Contract: ADR-569 Abort ingress; ADR-585 hold-stop lane","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Uncorrelated relay clients push makes the desktop refuse every command incl. Abort for one round trip and suppress replies"},
  {"id":"P3-6","severity":"P3","area":"remote-control","file":"services/remote-control/src/device.ts","line":224,"anchor":"Ground truth: OWASP API4:2023 unrestricted resource consumption","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"One approved client can occupy all 32 per-PC pending slots and starve other clients"},
  {"id":"P3-7","severity":"P3","area":"remote-control","file":"services/remote-control/src/limits.ts","line":46,"anchor":"Twin: POST pairing routes limited, GET status/authorize not","evidence":"READ","verdict":"PLAUSIBLE","known":false,"summary":"GET session/status/authorize bypass ingress limits; consent-record cap can be exhausted by one approved client"},
  {"id":"P3-8","severity":"P3","area":"remote-control","file":"services/remote-control/src/relay.ts","line":77,"anchor":"Ground truth: Cloudflare DO lifecycle; Twin: ledger unknown receipt","evidence":"SOURCE","verdict":"PLAUSIBLE","known":false,"summary":"Relay reset mid-command returns 'try again' instead of unknown for control commands (MCP retry risk)"},
  {"id":"P3-9","severity":"P3","area":"remote-control","file":"src/ui/remote-control/design-save.ts","line":26,"anchor":"Contract: ADR-584 save_project no picker","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Remote save of an invalid project opens a blocking PC confirm and save picker (latent)"},
  {"id":"P3-10","severity":"P3","area":"remote-control","file":"PROJECT.md","line":40,"anchor":"Contract drift: PROJECT.md vs ADR-584/ADR-585","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"PROJECT.md says file exchange, connection changes and recipe/layer creation are out of scope; they ship"},
  {"id":"P3-11","severity":"P3","area":"remote-control","file":"electron/mcp/design-schemas.ts","line":64,"anchor":"Twin: src/ui/layers/cut-settings-draft.ts bounds","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Remote update_operation accepts values outside PC Cut Settings bounds"},
  {"id":"P3-12","severity":"P3","area":"remote-control","file":"electron/mcp/tool-info.ts","line":83,"anchor":"Contract: ADR-584 update_operation field list","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"update_operation tool description lists only four fields"},
  {"id":"P3-13","severity":"P3","area":"remote-control","file":"src/ui/remote-control/validation.ts","line":36,"anchor":"Twin: z.uuid() in relay/main","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Renderer UUID regex rejects nil/max UUIDs accepted by relay; ledger slot consumed"},
  {"id":"P3-14","severity":"P3","area":"remote-control","file":"electron/remote-access/routes.ts","line":66,"anchor":"Twin: renderer fault codes vs main error map","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"control_required reaches clients as generic failed"},
  {"id":"P3-15","severity":"P3","area":"remote-control","file":"electron/mcp/machine-schemas.ts","line":67,"anchor":"Twin: hold Z 20 mm (ADR-585), phone 10 mm, PC 5 mm","evidence":"REPRO","verdict":"PLAUSIBLE","known":false,"summary":"Discrete remote Z jog accepts up to 100 mm"},
  {"id":"P3-16","severity":"P3","area":"remote-control","file":"src/ui/remote-control/machine-execution.ts","line":126,"anchor":"Twin: PC useJogControlPreferences feed","evidence":"READ","verdict":"PLAUSIBLE","known":false,"summary":"Phone 'PC speed' jog uses fixed 3000/600 mm/min, not the PC's chosen jog speed"},
  {"id":"P3-17","severity":"P3","area":"remote-control","file":"src/ui/remote-control/machine-control-registry.ts","line":100,"anchor":"Contract: ADR-585 600 ms dead-man","evidence":"REPRO","verdict":"PLAUSIBLE","known":false,"summary":"No test covers registry dead-man arming or renderer heartbeat application; mutation leaves suite green"}
]
```
