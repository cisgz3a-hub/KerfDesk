# Controller audit v3 — D7 Network link

- **When:** 2026-10-22 21:30   **Tree:** origin/main @ `7cd526213` (audit worktree HEAD `a709d1ca1`;
  `git diff 7cd526213 HEAD -- electron src` is empty). `origin/main` moved to `d9a9aa0a6` during
  the audit. On the scoped files that move changes only `src/ui/state/laser-safety-notice.ts`
  (new refusal helpers; the USB texts in P3-3 are unchanged). **P2-1 is on `d9a9aa0a6` only:** it
  comes from PR #1366 (ADR-398 Amendment 3, merge `298e0ab4a`), which landed after `7cd526213`.
  The brief asks whether the network link reaches #1366's link-loss handling, so it is included.
- **Scope:**
  - Native side: `electron/machine-network-{bridge,protocol,routes,session,telnet}.ts`,
    `electron/app-route-guard.ts`, `electron/desktop-routes.ts`, the `app://` registration and
    window policy in `electron/main.ts`, `electron/desktop-window-options.ts`,
    `electron/trusted-renderer-policy.ts`.
  - Renderer transport: `src/platform/electron/desktop-machine-network{,-api}.ts`, compared with
    `src/platform/web/{web-serial,serial-read-loop,serial-wire}.ts`.
  - UI and store: `src/ui/laser/{MachineNetworkConnect.tsx,machine-network-profile.ts,connect-machine.ts}`,
    `src/ui/laser/device-setup/{machine-setup-connection,use-find-machine,find-machine-phase}.ts`,
    `src/ui/state/{laser-connect-action,laser-connection-actions,laser-controller-handshake,laser-controller-silence,laser-stream-heartbeat,laser-stream-heartbeat-containment,laser-safety-notice,laser-store-helpers}.ts`,
    `src/ui/app/use-auto-connect-controller.ts`.
  - Falcon pointer: `electron/falcon-pointer.ts`, its route in `electron/rtsp-camera-bridge.ts`,
    `electron/private-network-host-policy.ts`, `src/ui/app/use-falcon-pointer-link.ts`,
    `src/ui/state/falcon-pointer-link.ts`.
  - On `d9a9aa0a6`: `src/ui/app/link-loss-restart-tracking.ts`, `src/core/recovery/link-loss-restart.ts`.
  - Governing documents: ADR-601 (the only ADR naming the network channel), ADR-571 (FluidNC Telnet
    adapter), ADR-635 (Falcon pointer), ADR-398 Amendment 3, ADR-611 Amendment 1, ADR-354
    Amendment 1, ADR-356, WORKFLOW "Desktop Wi-Fi / Ethernet (ADR-601)", PROJECT.md
    non-negotiables 8 and 9. `docs/decisions` has no other hit for network, Wi-Fi, telnet,
    WebSocket, TCP, IPC or contextIsolation in this scope.
- **Primary sources fetched this session:**
  - grblHAL Plugin_networking `telnetd.c` @ `e0131fb2` (v2.6, 2026-03-30), `networking.h` @ `6c297119`,
    `README.md` (Telnet "raw" mode, Websocket).
  - grblHAL core `stream.c` @ `62f25d42`, `report.c` (`Bf:` and `report_init_message`), `grbllib.c`.
  - FluidNC `WebUI/TelnetClient.cpp`, `WebUI/TelnetServer.cpp` (main @ `ffad1dc7`), `Serial.cpp`
    (`AllChannels::registration`), `Protocol.cpp` (`report_init_message` only after a reset).
  - lwIP `src/core/tcp_in.c` @ `3d896ba0` (accept callback error → `tcp_abort`).
  - Electron security checklist (items 13, 14, 17, 18).
  - Node `net` internals of the local Node v25.8.2 (`afterConnect` applies a pre-connect
    `setNoDelay`; `destroy` vs `resetAndDestroy`). Electron 44.8.0's bundled Node was not checked.
- **Lenses run:** L1, L2, L3, L4, L5 (security), L6 and L7, as separate passes in this session (no
  subagents, to keep machine load low). L2 used the sources above.
- **Counts:** 6 raised (5 auditor + 1 refuter) → 0 refuted → P1 0 / P2 2 / P3 4 (+4 KNOWN).
  Refuter: 5 CONFIRMED (P2-1, P3-1..P3-4, all re-run on `origin/main` @ `662d958e9`), 1 PLAUSIBLE
  (refuter-raised D7-R1). No severity changes.

## Headline

The network link is not exposed: it is an `app://app` route, not a listening port, and only the
trusted renderer can call it. Its validation (exact route, custom header, Origin and
`Sec-Fetch-Site`, POST, 96 KiB body, canonical base64 payload ≤ 64 KiB, strict write sequence,
one session, bounded receive queue) holds. Realtime bytes go out raw with Nagle off, `0xFF` is
escaped only on the FluidNC Telnet channel, and grblHAL's streaming window is bounded by the
Telnet stream's own `Bf:`. A dropped or half-open link mid-job reaches the same heartbeat and
port-close containment as USB.

The serious gap is on current main. grblHAL greets **every** new Telnet client with its startup
banner, but #1366's link-loss rule reads a banner as proof that the controller restarted. A
grblHAL network board that kept burning through a Wi-Fi drop is therefore recovered as if it had
restarted. The automatic restart steps back over up to a planner of moves that did burn, and the
Review says the board "had restarted, as an Arduino-based board does" (P2-1).

The refuter confirmed P2-1 against main's real code. Two qualifications:

- It fires only when the loss surfaces as a socket close. More than 2 s of silence ends as
  `stream-stalled` and gets no verdict.
- The same misread plausibly hits grblHAL native-USB boards, which greet 200 ms after DTR rises
  (D7-R1).

The rest are P3s:

- the TCP transport re-implements line delivery without the serial loop's protections (P3-1);
- three operator texts assume USB on a TCP session (P3-2, P3-3);
- a grblHAL board that refuses a second Telnet client looks like "connected", then "closed
  unexpectedly" (P3-4).

## Message paths: path → validation → source

| Path | Validation on the path | Source / anchor |
|---|---|---|
| UI form → `serialForTarget(host, port, protocol)` | Form shown only for native FluidNC/grblHAL with no vendor command set; button needs non-empty host and an integer port 1–65535; host trimmed; protocol re-read from the current device at click | `MachineNetworkConnect.tsx:26-39,71,121`; `machine-network-profile.ts:168-174`; ADR-601 Decision ¶2 |
| Renderer → `app://app/api/machine-network/{open,read,write,close}` | `fetch` with `X-KerfDesk-Machine-Network: 1`, JSON body, 8 s (open) / 5 s abort, response ≤ 800 000 chars, object-only | `desktop-machine-network-api.ts:4-31` |
| `app://` handler → route | Exact `app://app` URL (no port, credentials, query, fragment); custom header `=== '1'`; `Origin` null or `app://app`; `Sec-Fetch-Site` null, `same-origin` or `none`; POST; action in the 4-name list; else 404 | `machine-network-routes.ts:27-36`; `app-route-guard.ts:6-27`; Electron checklist 17/18 |
| Route → bridge | Body streamed with a 96 KiB cap before `JSON.parse`; object only; `open`: host string, port number, protocol in `{fluidnc-telnet, grblhal-raw}`; others: `sessionId` `^[a-f0-9-]{36}$`; `write`: integer `sequence`, string `data` | `machine-network-routes.ts:50-103`; `machine-network-protocol.ts:3-9` |
| Bridge `open` → `net.Socket.connect` | Protocol re-validated; host is an IP literal or an RFC 1123 hostname ≤ 253, untrimmed refused; port integer 1–65535; one pending or open session; 5 s connect timeout | `machine-network-bridge.ts:13-39,76-110` (any host is allowed by ADR-601; rolling-v2 04 recorded that) |
| Bridge `write` → socket | Sequence must equal `nextWrite`, otherwise the session closes; canonical base64; 1–65 536 bytes; Telnet IAC doubling on the FluidNC channel only; 512 KiB `writableLength` cap (counts negotiation replies); resolves on the socket write callback | `machine-network-session.ts:69-96,129-139`; `machine-network-telnet.ts:50-57` |
| Socket → bridge `read` | Telnet framing removed on the FluidNC channel (DO→WONT, WILL→DONT, SB ≤ 4096 bytes); raw on grblHAL; 512 KiB receive queue, else close and discard; 1 s long-poll; final bytes kept for the last read | `machine-network-session.ts:33-68,99-126`; `machine-network-telnet.ts:1-48` |
| Bridge `read` → renderer lines | Payload ≤ 700 000 base64 chars; **fatal** UTF-8 decode; split on LF, trailing CR dropped; a line over 64 KiB closes the session; handlers called unguarded (P3-1) | `desktop-machine-network.ts:92-128` |
| Lifetime | 15 s lease renewed by every read/write; `will-quit` disposes; close requested on every renderer close | `machine-network-bridge.ts:60-67`; `machine-network-routes.ts:19-26` (crash/reload window is KNOWN 04-P3-23) |
| Falcon pointer | Camera bridge on `127.0.0.1:51731`; Host header `127.0.0.1|localhost:<port>`; Origin required (`app://app` or loopback http); POST; host a plain-decimal private IPv4, never 127/8; fixed `:8080/device/assistLight`, fixed body, `redirect: 'error'`, 5 s, 4 KiB reply | `rtsp-camera-bridge.ts:46-80,235-237,254`; `falcon-pointer.ts:32-107`; ADR-635 (loopback origins are KNOWN 04-B-1) |

## Answers to the brief

1. **Exposure.**
   - No port is opened for the machine link: it is a `protocol.handle('app')` route
     (`main.ts:542-552`).
   - A web page cannot reach `app://`, and another local process has nothing to connect to.
     Cross-origin callers fail the header and Origin checks.
   - Every request is validated for origin, host, port and size (table above).
   - Untrusted content cannot run in the renderer: navigation and redirects are locked to the
     trusted origin, `window.open` is denied, the CSP is `script-src 'self'`, and the one
     `srcdoc` iframe (print) holds KerfDesk's own SVG export under the inherited CSP.
   - The Falcon pointer is not tied to the connected machine. Any private IPv4 is accepted, and
     the renderer uses the Falcon camera's address (ADR-635 chose this). It cannot be used as an
     SSRF vector beyond a fixed POST to `:8080/device/assistLight` on a private host. Redirects
     are refused. Loopback-origin reachability is KNOWN (04-B-1).
2. **Realtime bytes.**
   - `setNoDelay(true)` before connect is applied in Node's `afterConnect` (verified in Node
     source).
   - Realtime bytes are written raw, one per request, in order behind earlier writes. The serial
     writer orders them the same way.
   - `0x18` survives on both channels.
   - IAC: FluidNC `filteredRead` turns `IAC IAC` into one `0xFF`, and KerfDesk doubles `0xFF`. The
     grblHAL telnetd "passes raw bytes", and KerfDesk sends raw bytes.
   - Window: FluidNC is forced ping-pong. grblHAL is bounded by `Bf:`, which grblHAL reads from
     `hal.stream.get_rx_buffer_free()`. With Telnet active that is telnetd's `streamRxFree`
     (`RX_BUFFER_SIZE - 1 - count`).
3. **Link loss.**
   - FIN or RST closes the session at once (REPRO E: disconnected within the wait).
   - A half-open link during a job is caught by the transport-independent heartbeat: 2 s, with up
     to 3 scheduling graces (`laser-stream-heartbeat.ts:7-19`). That heartbeat freezes the stream
     and quarantines the port.
   - No TCP keepalive is set. When idle, a dead peer shows "Not responding" (ADR-611 Amendment 1)
     until the OS gives up on the status-poll writes.
   - A half-open socket cannot keep a job "streaming": acknowledgements and fresh status are both
     required.
   - Port close reaches the same `buildPortClosePatch` notice as USB, but with USB wording
     (P3-3).
   - On `d9a9aa0a6`, #1366's verdict misreads grblHAL's Telnet greeting (P2-1).
4. **Reconnect and identity.**
   - Every network connect is an explicit operator action. It reruns the full handshake and
     qualification, and its firmware family must match the profile.
   - No hardware identity is checked. That matches USB (VID/PID only).
   - grblHAL serves one Telnet client and refuses others. KerfDesk does not explain that refusal
     (P3-4).
   - FluidNC registers every Telnet client as a command channel without login. That is known
     firmware behaviour (2026-07-13 cybersecurity audit), and no sender can detect it.
   - Two KerfDesk windows on one PC are prevented by the single-instance lock.
5. **Twin.**
   - No address is stored: the form state is component-local, `rememberSerialPort` skips `tcp`,
     and incidents carry `{transport:'tcp'}` only.
   - The setup target and the open target are the same captured object.
   - The silence text and the link-loss texts do not match the transport (P3-2, P3-3).

## Findings

### P2-1 — On current main, every grblHAL network reconnect after a lost link reads as a controller restart, so the automatic restart re-burns up to a planner of moves and the Review states a false cause
- **Where:** origin/main @ `d9a9aa0a6` (PR #1366, not in `7cd526213`):
  - `src/ui/app/link-loss-restart-tracking.ts:25`: `if (state.detectedControllerKind !== null) return 'boot-banner';`
  - `src/core/recovery/link-loss-restart.ts:25-28,50`: a banner moves the held-back backlog into
    `plannerBacklog` with the "restarted" message.
  - The rule is applied for every transport. No `tcp` check exists in either file.
- **Anchor:**
  - **Ground truth:**
    - grblHAL core `stream.c` @ `62f25d42` L394-397: the `StreamType_Telnet` case sets
      `send_init_message = add && sys.driver_started;`.
    - L433-434: `grbl.report.init_message(stream->write)`, the same
      `GrblHAL 1.1f ['$' or '$HELP' for help]` line as at boot (`report.c:307-316`).
    - `telnetd.c` @ `e0131fb2` L442-443 calls `stream_connect(&telnet_stream)` for each accepted
      client.
    - On disconnect, `streamClose` (L239-249) flushes the Telnet RX and TX rings and switches back
      to the base stream. It has no feed hold or reset, so the planner keeps running.
    - FluidNC's `TelnetServer::poll` only registers the client, and its banner follows a reset
      only (`Protocol.cpp:700`). FluidNC is read correctly.
  - **Contract:** ADR-398 Amendment 3, Consequences: "A board that neither resets when its port
    opens nor loses power shows no banner on reconnect, so its restart is unchanged." That is
    false for grblHAL over Telnet.
- **Scenario:**
  1. A grblHAL laser on Wi-Fi runs a raster job and the Wi-Fi drops. The run is saved as
     `disconnect`, with `plannerBacklogIfRestarted` = the status-report backlog, or else the
     whole planner (100 blocks by default).
  2. grblHAL flushes the Telnet RX ring and keeps executing its planner.
  3. The operator reconnects through the network form. grblHAL sends its banner before any
     status, and the first sign is `boot-banner`.
  4. The saved laser run is revised: the restart steps back over the backlog, so those moves,
     which did burn, burn again (a darker band on engraving).
  5. Review text: "The USB connection was lost during the job, and the controller sent its
     startup banner when it reconnected. It had restarted, as an Arduino-based board does …".
     Neither the cause nor the transport is true.
- **Evidence:**
  - **REPRO** (`electron/zz-d7-network-store.test.ts`, REPRO D). The setup is the real store,
    real `app://` routes, `MachineNetworkBridge` and loopback TCP. The modelled grblHAL never
    resets and greets each client as `stream.c` does. #1366's `linkLossRestartEvidence` is copied
    verbatim from `d9a9aa0a6`.
  - Output: `first reconnect evidence: [ 'boot-banner detected=grblhal status=none' ]`.
  - **SOURCE:** the grblHAL lines above. **READ:** the #1366 settle path. It was not run against
    main's recovery repository, because main was not checked out in this shared worktree.
  - The existing `machine-network-renderer-integration.test.ts:81,150` already models the
    greeting and asserts `detectedControllerKind: 'grblhal'` after a TCP connect.
- **Why P2, not P1:**
  - The recovery is reviewed and opt-in.
  - The error is in the over-burn direction that ADR-398 Decision 2 accepts under uncertainty.
  - Continue from where the head stopped stays available.
  - But the operator is told a false cause and has no way to see that it is false.
- **Cross-area note:** the D6 report's identity table (row "grblHAL, native USB / network |
  *(no banner)*") conflicts with `stream.c` for the Telnet stream.
- **Refuter:** CONFIRMED. P2 stands; the trigger is narrower than step 1 says.
  - **Ground truth, re-fetched** (grblHAL core `master` @ `4ec1ae44`, 2026-10-15; Plugin_networking
    `master` @ `0b665ee0`, 2026-10-08):
    - `stream.c` `stream_select`: `case StreamType_Telnet:` sets `send_init_message = add && sys.driver_started;`,
      then `grbl.report.init_message(stream->write)`. No machine-state condition, so a client that
      connects mid-job or idle is greeted. WebSocket and Bluetooth connects greet the same way.
    - `telnetd.c` `telnet_accept` calls `stream_connect(&telnet_stream)` for each accepted client.
      `streamClose` only flushes the Telnet rings and calls `stream_disconnect`.
    - No hold or reset on disconnect. A grblHAL org code search for `on_stream_changed` finds only
      hooks that track the stream (`networking.c`, Plugins_laser `lb_clusters.c`). The planner keeps
      running the moves it acknowledged, so the re-burn is physical.
  - **REPRO against main's real code.** Temporary detached worktree on `origin/main` @ `662d958e9`,
    `electron/zz-d7r-reconnect.test.ts` (deleted).
    - Setup: the real `installLinkLossRestartTracking` with a stand-in repository holding a
      lost-link laser capsule, plus the real store, `app://` routes, `MachineNetworkBridge` and
      loopback TCP. The modelled grblHAL never resets: it greets and reports Idle.
    - Output: `settle evidence: boot-banner | transport: tcp | detected: grblhal`.
    - Main's real `settleLinkLossRestart` and `automaticRestart` ran on a 600-move program with 400
      lines acknowledged and a last-status backlog of 31 blocks at 395. The banner verdict restarts
      at line 365 (`status-backlog`, 31 blocks); the kept-running verdict restarts at line 401. That
      is **36 extra lines replayed**: the status backlog plus the lines acknowledged after that
      status. With no status snapshot the bound is the grblHAL default of 100 blocks.
  - **Gate.** The replay is not automatic.
    - The Review's "Choose where to restart" defaults to Automatic (`LaserRecoveryRestartPicker.tsx`).
    - Its hint states as fact "the controller had about 31 moves buffered when it stopped and
      discarded them", then adds "Some may have burned already … inspect the work".
    - Start needs the operator's confirmation, and Continue from where the head stopped stays
      available.
    - So the finding is a misleading default with a false cause and a broken ADR-398 Amd 3
      consequence: P2, not P1.
  - **Narrowing.** Only a loss that shows up as a socket close is saved as `disconnect`. That
    includes FIN, RST, a socket error, a bridge close (lease expiry, receive overflow) and P3-1's
    closes.
    - An outage with more than 2 s of silence is caught first by the heartbeat. It is saved as
      `stream-stalled` (`checkpoint-interruption.ts` `noticeKind`), and that kind awaits no verdict
      (`awaitsLinkLossVerdict` needs `disconnect`). The refuter's heartbeat REPRO below shows that
      path.
    - Realistic triggers are therefore narrower:
      - a board-side deauth shorter than 2 s (telnetd `onNetworkEvent` closes the session, then FIN);
      - an lwIP abort on the board;
      - a PC-side IP change or adapter reset;
      - a close made by KerfDesk itself.
  - **D6 cross-check.** The D6 row "grblHAL, native USB / network | *(no banner)*" is wrong:
    - for the network (Telnet, WebSocket and Bluetooth connects all greet, `stream.c` `stream_select`);
    - for native USB on drivers with line-state events (see D7-R1).
    - It holds only for drivers without line-state events: none was found in iMXRT1062 (Teensy 4).
    - D6-P3-2's conclusion ("not always a banner") still stands.
- **Fix direction:**
  - Do not treat a banner on a TCP session as restart evidence. grblHAL greets every Telnet
    client. Decide by Alarm or status, or by a restart sign that the greeting cannot fake.
  - Fix together with D7-R1. The same rule misreads grblHAL's DTR greeting on native USB.
  - Add a `link-loss-restart-tracking` case for a TCP reconnect with a greeting.
  - Correct the ADR-398 Amd 3 consequence and the D6 table row.

### P3-1 — The TCP transport re-implements line delivery without the serial read loop's protections: one throwing subscriber or one non-UTF-8 byte closes a live job's connection
- **Where:**
  - `src/platform/electron/desktop-machine-network.ts:32` (`new TextDecoder('utf-8', { fatal: true })`).
  - `:101` (one decode per read).
  - `:113-128` (`for (const handler of this.lines) handler(line)` at `:125`, unguarded).
  - `:109-111` (`catch { await this.close(); }`, which logs no reason).
- **Anchor:** **Twin:**
  - `src/platform/web/serial-read-loop.ts:180-195` (`dispatchLine`): "Subscriber exceptions must
    not masquerade as a dropped cable … a full mid-job 'port closed'".
  - `:99`: a non-fatal decoder.
  - ADR-356 read slices (`serial-read-slice.ts`).
  - `serial-wire.ts:1-4`: the framing is shared "so the two can never disagree about … how a line
    is recognized". The TCP transport is a third copy.
  - The 2026-10-16 reconnect audit isolated close subscribers for serial and TCP, but not line
    subscribers for TCP.
- **Scenario:**
  - (a) While a TCP job streams, any exception from the store's line subscriber closes the
    session. That includes a store listener throwing inside its `set`. The result is "Controller
    connection closed unexpectedly", the job is interrupted, and the planner keeps running. On
    USB the same exception is logged and the job continues.
  - (b) One byte that is not valid UTF-8 in a grblHAL raw read discards that whole read,
    including its `ok`s, and closes the session with no reason in the log. USB yields `U+FFFD`
    and goes on.
  - (c) A backlog read of up to 512 KiB is dispatched in one task, with no ADR-356 slice.
  - The close on an over-long line is deliberate and tested
    (`desktop-machine-network.test.ts:107`), so it is excluded.
- **Evidence:** REPRO (`src/platform/electron/zz-d7-line-delivery.test.ts`; the same payload goes
  to the TCP connection and to `runSerialReadLoop`).
  - A: `network {"lines":[],"closed":1,"closeRequests":1}` and
    `serial {"lines":["ok","<Run|MPos:1.000,2.000,0.000|FS:600,0>","ok"]}`.
  - B (`ok\r\n` 0xFF `[MSG:x]\r\nok\r\n`): `network {"lines":[],"closed":1,…}` and
    `serial {"lines":["ok","\uFFFD[MSG:x]","ok"]}`.
- **Why P3:** latent. No throwing subscriber and no non-UTF-8 controller output was found
  in-tree or in the firmware sources read.
- **Refuter:** CONFIRMED. P3 stands, not P2.
  - **Re-run on `origin/main` @ `662d958e9`.** `desktop-machine-network.ts` is unchanged there.
    - A: `network {"lines":[],"closed":1,"closeRequests":1}`; serial delivers all 3 lines.
    - B: the same.
    - Added case: a UTF-8 lead byte cut off before CRLF (`[MSG:caf` 0xC3 `\r\nok\r\n`) also
      closes, with `closed:1`.
    - Valid UTF-8 split across two reads is decoded correctly (`stream: true`).
  - **Why not P2:** a single noisy byte cannot reach this decoder on a native network link.
    - TCP and Wi-Fi/Ethernet frames are checksummed, so line noise does not reach the decoder. A
      non-UTF-8 byte would have to come from the firmware itself.
    - grblHAL and FluidNC report text is ASCII.
    - KerfDesk folds every comment it emits to ASCII (`gcode-comments.ts` `asciiFold`) and emits
      no `(MSG,` comments, so during a job the controller has nothing non-ASCII to echo.
    - "One noisy byte" is a UART-leg risk. Native-network grblHAL and FluidNC have no UART leg.
    - Re-rate it P2 if a UART-to-Wi-Fi bridge target is ever offered.
  - **Link to P2-1:** when the close does fire, it is saved as `disconnect`. The board keeps
    running, greets on reconnect, and P2-1's misread follows.
- **Fix direction:**
  - Reuse `extractSerialLines` and the `dispatchLine` isolation (and the read slice) in
    `DesktopMachineConnection`.
  - Decode non-fatally.
  - Log why the read loop ended.

### P3-2 — A TCP controller that stays silent is reported as a baud-rate and cable fault
- **Where:**
  - `src/ui/state/laser-controller-silence.ts:77-99` (`silenceMessages`), fed the open request's
    baud rate by `laser-controller-handshake.ts:96-103`.
  - TCP sessions carry no baud: `laser-connection-actions.ts:174` sets `connectedBaudRate: null`,
    and `ConnectedMachineProfile.tsx` hides it.
- **Anchor:** **Twin:**
  - Machine Setup's network text (`find-machine-phase.ts:151`): "No controller answer came back
    from <host:port>. Check the target and its enabled network service".
  - The connected-profile card, which shows no baud for `tcp`.
- **Scenario:**
  1. The operator enters a port whose service waits silently, for example one that expects its
     own handshake, or the controller's Telnet stream is not the one answering.
  2. After about 10 s, qualification fails with "No controller response was received at 115200
     baud. Check the cable and controller profile, then retry."
  3. The log reads "Check baud rate (115200)".
  4. Neither applies to Wi-Fi or Ethernet. The real checks are the port and whether the network
     service is enabled.
- **Evidence:** REPRO (`electron/zz-d7-network-store.test.ts`, REPRO C, silent loopback server):
  - `qualification: {"kind":"failed","epoch":1,"message":"No controller response was received at 115200 baud. Check the cable and controller profile, then retry."}`
  - `serialPortInfo: {"transport":"tcp"} baud: null`
  - `log: ["[lf2] No controller response within 10 s. Check baud rate (115200) and that the device is grblHAL."]`
- **Refuter:** CONFIRMED.
  - REPRO C re-run on `origin/main` @ `662d958e9` gives the identical qualification text,
    `serialPortInfo {"transport":"tcp"} baud: null`, and the "Check baud rate (115200)" log.
  - `silenceMessages` (`laser-controller-silence.ts:77-99`) takes no transport input.
  - P3 stands.
- **Fix direction:** choose the silence text by transport, reusing setup's network wording.

### P3-3 — Link-loss and stall notices on a TCP session say "USB connection was lost" and "check the USB link/cable"
- **Where:** `src/ui/state/laser-safety-notice.ts`:
  - `:105-108` (stream stalled: "check the USB link");
  - `:155-158` (reboot: "Check the USB cable");
  - `:165-168` (job: "USB connection was lost during an active job");
  - `:174-177` (motion);
  - `:189-191` (Fire).
  - Chosen by `laser-store-helpers.ts:478-489` with no transport input.
  - On `d9a9aa0a6`, `link-loss-restart.ts:26,31` adds two more "The USB connection was lost"
    texts.
- **Anchor:** **Twin:**
  - The session's transport is known (`serialPortInfo.transport`, `lastConnectionTransport`).
  - `NETWORK_RECONNECT_GUIDANCE` (`laser-connect-action.ts:54-55`) already tells TCP users how to
    reconnect.
  - ADR-601 / WORKFLOW "Desktop Wi-Fi / Ethernet" step 4.
- **Scenario:**
  1. A Wi-Fi or Ethernet link drops mid-job.
  2. The banner reads "USB connection was lost during an active job … Reconnect and home before
     continuing."
  3. The operator looks for a USB cable that does not exist. The ordinary Reconnect is blocked
     for TCP (it only shows the guidance toast).
  4. The safety advice itself (E-stop) is right.
- **Evidence:** REPRO (`electron/zz-d7-network-store.test.ts`, REPRO E: qualified TCP session,
  streamer set to `streaming`, server socket destroyed):
  - `transport hint: tcp`
  - `notice: {"kind":"disconnect-during-job","message":"USB connection was lost during an active job. …"}`
- **Refuter:** CONFIRMED.
  - REPRO E re-run on `origin/main` @ `662d958e9`: `transport hint: tcp`, with the same
    `disconnect-during-job` "USB connection was lost …" notice.
  - On main the USB texts sit at `laser-safety-notice.ts:110,160,168,177,192` (shifted by main's
    new helpers).
  - The P2-1 REPRO printed one of `link-loss-restart.ts`'s two added "The USB connection was lost"
    texts on a TCP session.
  - P3 stands. The E-stop advice is right.
- **Fix direction:**
  - Make the transport an input to these notices, as the connection card does.
  - Say "network connection" for `tcp` and point to the network form.

### P3-4 — A grblHAL board that refuses KerfDesk's Telnet connection (another client, or a stale session) reads as "TCP channel connected", then "closed unexpectedly"
- **Where:**
  - `src/ui/laser/MachineNetworkConnect.tsx:45-52`: the form message is read once, when
    `connectMachine` resolves.
  - `src/platform/electron/desktop-machine-network.ts:102-105`: the bridge's reason only goes to
    `console.warn`.
  - `src/ui/state/laser-connection-actions.ts:155-170`: the generic incident.
- **Anchor:**
  - **Ground truth:**
    - `telnetd.c` @ `e0131fb2` L409-410: `return ERR_CONN; // Busy, refuse connection`.
    - lwIP `tcp_in.c` @ `3d896ba0` L958-965: an accept error makes lwIP `tcp_abort` the new pcb
      (RST after the handshake).
    - `networking.h` @ `6c297119` L59-60: `SOCKET_TIMEOUT 0`, so there is no idle timeout.
    - `telnetd.c` L437-440: the keep-alive timing line is commented out, so lwIP's default
      applies when keep-alive is compiled in.
  - **Twin:** a USB port held by another program fails at open, and the failure is logged with
    its reason (ADR-639).
- **Scenario:**
  1. A grblHAL board still holds a Telnet client. That can be another sender, or KerfDesk's own
     old session after a PC crash, sleep, or an outage longer than the PC's FIN retransmissions.
  2. Connect opens the socket, so the form says "TCP channel connected; controller qualification
     is shown above."
  3. The board resets the socket. The bar goes Disconnected with "[lf2] Controller connection
     closed unexpectedly."
  4. Nothing says the board serves one Telnet client. Each retry repeats until the board drops
     the old session, usually only at a power cycle.
- **Evidence:** REPRO (`electron/zz-d7-network-store.test.ts`, REPRO F; the server accepts, then
  `resetAndDestroy()`):
  - `connection right after connect() resolved: connected`
  - `connection later: {"kind":"disconnected"}`
  - `log: [… "[lf2] Controller connection closed unexpectedly."]`
  - The bridge reason "Network transport failed; command delivery may be uncertain." appears on
    the console only.
  - The lwIP and grblHAL behaviour is SOURCE. No board was operated.
- **Refuter:** CONFIRMED.
  - **Source, re-fetched.**
    - `telnetd.c` (`master` @ `0b665ee0`) `telnet_accept` has
      `if(session->pcb) return ERR_CONN; // Busy, refuse connection`.
    - lwIP `tcp_in.c` (`master`) L958-965 calls the accept callback only after the handshake and
      `tcp_abort`s the pcb on an error. The client's connect therefore succeeds, then gets an RST.
  - **REPRO F** re-run on `origin/main` @ `662d958e9`: `connected`, then
    `{"kind":"disconnected"}` and "Controller connection closed unexpectedly."
  - P3 stands.
- **Fix direction:**
  - Treat a close within a moment of open, with no bytes received, as a refusal.
  - Name the likely causes: another sender, or the board still holding an old session (restart
    its network or power-cycle it).
  - Update the form message when the connection drops.

### D7-R1 (REFUTER-RAISED, P2) — The same misread hits grblHAL native-USB boards: grblHAL prints its welcome 200 ms after DTR rises, without rebooting
- **Where:**
  - origin/main @ `662d958e9`: `src/ui/app/link-loss-restart-tracking.ts:25`, the same rule as
    P2-1.
  - The handshake's passive wait, `PASSIVE_STARTUP_WAIT_MS = 250` in
    `src/ui/state/laser-controller-handshake.ts:42,153`. Status polling starts only after the
    handshake (`laser-connection-actions.ts:207-226`).
- **Anchor:**
  - **Ground truth:**
    - grblHAL core `stream.c` (`master` @ `4ec1ae44`) `stream_usb_linestate_changed`: when
      `state.dtr && hal.stream.state.is_usb && !hal.stream.state.passthru`, it runs
      `task_add_delayed(output_welcome_message, NULL, 200)`. That is the same `report_init_message`
      as at boot, with no reset.
    - These driver CDC line-state handlers call it: RP2040 `usb_serial.c:318-322`
      (`tud_cdc_line_state_cb`) and STM32F4xx `USB_DEVICE/App/usbd_cdc_if.c:230-233`
      (`CDC_SET_CONTROL_LINE_STATE`).
    - A grblHAL org code search also lists STM32F1xx/F3xx/F7xx `usbd_cdc_if.c`, ESP32
      `main/usb_serial.c` and LPC176x `cdc_vcom.c`. None was found in iMXRT1062 (Teensy 4).
    - Chromium `services/device/serial/serial_io_handler_win.cc:244`
      `config.fDtrControl = DTR_CONTROL_ENABLE`, so DTR rises at open.
    - Already noted in `docs/audits/2026-09-25-controller-full-audit.md:1819` ("grblHAL prints its
      welcome 200 ms after DTR without rebooting"), before #1366.
  - **Contract:** ADR-398 Amendment 3, Consequences: "A board that neither resets when its port
    opens nor loses power shows no banner on reconnect".
- **Scenario:**
  1. An externally powered grblHAL native-USB laser (RP2040 or STM32) loses USB mid-job (EMI, a
     hub reset, a knocked cable).
  2. Web Serial errors, so the run is saved as `disconnect` with the backlog held aside. On USB a
     lost link is always a port close, unlike TCP (see P2-1's narrowing), so this is the common
     path.
  3. The board keeps running its planner.
  4. Auto-connect reopens the port within about 1 s. DTR rises, and the welcome arrives about
     200 ms later, inside KerfDesk's 250 ms passive window, before its first `?`.
  5. The first sign is `boot-banner`. Automatic steps back over the backlog, up to the 100-block
     grblHAL default, and those moves had burned.
  6. The Review says the controller "had restarted, as an Arduino-based board does".
- **Evidence:**
  - SOURCE: the lines above.
  - READ: the handshake timing.
  - The rule is transport-blind and gives `boot-banner` for any banner first (P2-1 REPRO). Main's
    own `recovery-link-loss-restart.simulator.test.tsx` (case 1) steps back on a banner at open
    with nothing that checks a reset happened.
  - The 200 ms vs 250 ms race was not reproduced on hardware.
- **Refuter:** PLAUSIBLE (raised by the refuter; the coordinator must re-verify).
- **Fix direction:**
  - The same fix cluster as P2-1: for grblHAL, a banner is not restart evidence, on either
    transport.
  - Decide by the first status instead: Run, MPos continuing from the last report, or Alarm.

## KNOWN (re-observed, not raised)

- **rolling-v2 04-P3-23:** the bridge session outlives a crashed or reloaded renderer for 15 s,
  and Connect is refused meanwhile (`machine-network-bridge.ts:60-67`).
- **rolling-v2 04-B-1:** the camera bridge, which hosts `/falcon/pointer`, trusts any
  `http://localhost|127.0.0.1` Origin in packaged builds. It is accepted by ADR-133, ADR-141 and
  ADR-635.
- **rolling-v2 04-P3-8:** PROJECT.md's desktop security paragraph omits the
  `/api/machine-network` route.
- **2026-07-13 cybersecurity audit:** FluidNC registers every Telnet client as a command channel
  without login. Re-confirmed in `TelnetServer::poll` (`allChannels.registration(tnc)` for each
  pending client). It is firmware behaviour and no sender can detect it.

## Refuted

None. The refuter could not break any raised finding: P2-1 and P3-1 to P3-4 were each re-run on
`origin/main` @ `662d958e9`. Candidates the auditor checked and dropped before raising:

- **"Nagle is not disabled because `setNoDelay` runs before `connect`."** Node's `afterConnect`
  applies the stored flag (`net.js` `if (self[kSetNoDelay] && self._handle.setNoDelay)`), and so
  does the multi-address path.
- **"FluidNC needs no IAC escaping," or the reverse for grblHAL.** FluidNC `filteredRead` decodes
  `IAC IAC` → `0xFF` and drops option sequences. grblHAL telnetd passes bytes raw. KerfDesk
  matches both.
- **"The character-counting window ignores the network buffer."** grblHAL's `Bf:` comes from the
  active stream's `get_rx_buffer_free` (telnetd `streamRxFree`), and FluidNC is ping-pong.
- **"A web page or another process can drive the laser through the bridge."** No port is opened,
  and the app route needs the trusted header and Origin.
- **"The network address is persisted or leaks into diagnostics."** It does not:
  `serial-port-memory.ts:80` returns early for `tcp`, and incidents carry only the transport.
- **"A hidden window throttles the TCP read loop and expires the lease."** `backgroundThrottling`
  is off (`desktop-window-options.ts`), and the loop runs on fetch promises.
- **"FluidNC over Telnet is misread as restarted by #1366."** FluidNC sends its banner only after
  a reset.

## Verified clean

- **Trust boundary.**
  - The route is reachable only from the trusted renderer: `trustedAppRequest` and the custom
    header, with no CORS on `app://`.
  - Navigation, redirect and `window.open` are locked. The renderer runs with `contextIsolation`,
    `sandbox`, `nodeIntegration: false` and `webSecurity`, under the CSP
    `script-src 'self'; connect-src 'self' <bridge>` (Electron checklist 3, 4, 6, 7, 13, 14, 18).
  - Every request is bounded (body 96 KiB, payload 64 KiB, receive queue 512 KiB, response
    700 000 chars), with one session and strict monotonic sequences.
- **Protocol isolation.** The protocol is validated at the route and again in the bridge. The
  Telnet codec is applied only to `fluidnc-telnet`, and both directions are tested.
- **Uncertain delivery.** A write failure, an out-of-order sequence, an overflow or Telnet framing
  error closes the session without replay. The renderer refuses queued writes once closed, and
  close subscribers are isolated.
- **Transport routing (ADR-601).** After a TCP attempt, Reconnect, auto-connect and remote Connect
  never pick a remembered USB port (`laser-connect-action.ts:78-88`,
  `use-auto-connect-controller.ts:69`). Forget clears the hint.
- **Setup.** Setup's baud scan is off for a network target (`use-find-machine.ts:69-74`).
  Changing the setup family blocks a retry (`machine-setup-connection.ts:25-29`).
- **Link-loss containment.**
  - The heartbeat covers `grbl-v1.1`, `grblhal` and `fluidnc`.
  - Port close mid-job marks the stream interrupted and raises the disconnect notice (wording:
    P3-3).
  - Lines carried by a closing read are delivered before close.
- **Falcon pointer (ADR-635).**
  - The host must be plain-decimal private IPv4 and not 127/8; port, path and body are fixed.
  - `redirect: 'error'`, a 5 s timeout and a 4 KiB reply cap apply. Requests are queued per host
    behind camera frames.
  - Its address comes from the Falcon camera, by design.
- **Abort reachable (non-negotiable 9).** Abort and reset write `0x18` through the same ordered
  queue with the 500 ms reset-write deadline. No modal sits on that path.
- **Refuter spot-checks** (on `origin/main` @ `662d958e9`):
  - **"No port is opened; only the trusted renderer can call `app://app`": HOLDS.**
    - The bridge is reachable only through `withMachineNetworkRoutes` in `desktop-routes.ts`, the
      `app://` handler.
    - The other listeners do not import the bridge: `rtsp-camera-bridge.ts` and
      `artcraft-process.ts` (which listens on `127.0.0.1:0`).
    - The `app` scheme's privileges grant no `corsEnabled` or `bypassCSP`.
    - `sameOriginRequest` accepts a missing Origin but not the opaque `"null"` string.
    - There is one `BrowserWindow`.
  - **"A half-open link mid-job is caught by the 2 s heartbeat": HOLDS** for `streaming` and
    `done`.
    - REPRO: a loopback peer stays connected but stops answering mid-job. The result is a
      `stream-stalled` notice after 2447 ms, `0x18` written, then the connection quarantined
      (`disconnected`).
    - Scope: `detectActiveStreamHeartbeatLoss` sets no probe in other states, such as a paused
      or held job. USB behaves the same.
    - This path records `stream-stalled`, not `disconnect`, so it never reaches P2-1's verdict.

## Not verified

- **Physical hardware.** No grblHAL or FluidNC network board was operated. The greeting in P2-1
  and the refusal in P3-4 rest on source plus loopback models.
- **Main's recovery repository with a TCP reconnect (P2-1).** main was not checked out in this
  shared worktree. The auditor exercised a verbatim copy of the verdict rule and read the settle
  path.
  - The refuter then ran main's real tracking, settle and restart-line code over loopback TCP.
  - The repository was a stand-in, not main's IndexedDB repository.
- **D7-R1 timing on hardware.** The 200 ms DTR welcome against KerfDesk's 250 ms passive window
  is source and code reading only. No native-USB grblHAL board was operated.
- **grblHAL `on_stream_changed` hooks.** Whether any grblHAL plugin or driver hooks
  `grbl.on_stream_changed` to hold or reset on a Telnet disconnect was not checked. The core and
  telnetd do neither.
- **Late delivery after a graceful close.**
  - `session.close` uses `socket.destroy()`, which is a graceful close. Bytes already accepted by
    the kernel can still reach the controller if the link recovers before the OS gives up.
  - In the heartbeat path KerfDesk writes `0x18` first, so a late delivery ends in a reset.
  - The idle case (a jog clicked during an undetected outage, then delivered late) depends on the
    jog acknowledgement handling. It was not traced.
- **Lease expiry under a long renderer stall.** A renderer main-thread stall of 15 s or more
  mid-job closes the TCP session, where USB would only pause. ADR-601 accepts renderer leases,
  and WORKFLOW asks the operator to keep the app responsive. The size of real-world stalls was
  not measured.
- **FluidNC drops lines on Telnet.** FluidNC's Telnet TX queue drops non-critical lines (status,
  `[GC:`, `[MSG:`, `$` settings) silently when full; only `ok`/`error:`/`ALARM:`/`[MSG:ERR:` are
  reserved. KerfDesk reads continuously, so this should not trigger. The effect on a
  settings-read qualification was not tested.
- **Electron 44.8.0's Node.** The bundled Node's `net.js` was not checked. The local Node 25.8.2
  was.
- **Handed on.** Open PR #1386 ("Falcon A1 Pro LED: show where it will burn with the laser at
  low power", ADR-660) changes `falcon-pointer.ts`, `rtsp-camera-bridge.ts` and the pointer link.
  If it switches the laser itself over the Falcon's HTTP server, its host binding is the
  camera-discovered address, not the connected controller. Audit that before merge.

Repros (deleted from the tree; copies kept):
`C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\d7-repros\zz-d7-line-delivery.test.ts`
(REPRO A, B; place in `src/platform/electron/`) and
`C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\d7-repros\zz-d7-network-store.test.ts`
(REPRO C to F; place in `electron/`). Run each with
`NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run <file> --silent=false`.

The refuter's repros ran in a temporary detached worktree on `origin/main` @ `662d958e9`. That
worktree has been removed, and the repros were not kept:

- `electron/zz-d7r-reconnect.test.ts` (P2-1);
- `src/platform/electron/zz-d7r-line-delivery.test.ts` (P3-1);
- `electron/zz-d7r-network-store.test.ts` (P3-2 to P3-4, and the heartbeat spot-check).

Vitest suppresses console output in this repo, so the repros wrote their output to scratchpad
files.

```json
[
  {"id":"D7-P2-1","severity":"P2","area":"ctl-network-link","file":"src/ui/app/link-loss-restart-tracking.ts","line":25,"anchor":"Ground truth: grblHAL core stream.c@62f25d42 L394-397,433-434 (Telnet stream connect sends init_message), telnetd.c@e0131fb2 L239-249,442-443; Contract: ADR-398 Amd 3 Consequences 'neither resets ... shows no banner on reconnect'","evidence":"REPRO+SOURCE","verdict":"CONFIRMED","known":false,"summary":"On origin/main d9a9aa0a6 (PR #1366, after the audited tree): grblHAL greets every Telnet client with its banner, so a network board that kept running after a lost link is settled as restarted; the automatic restart steps back over up to a planner of burned moves and the Review claims an Arduino-style restart over USB. Refuter: reproduced with main 662d958e9's real tracking/settle/restart code over loopback TCP (boot-banner; 36 extra lines replayed for a 31-block status backlog, up to 100 by default); operator-confirmed Review, so P2; only losses that surface as a socket close (not >2 s silence, which ends stream-stalled) reach it"},
  {"id":"D7-P3-1","severity":"P3","area":"ctl-network-link","file":"src/platform/electron/desktop-machine-network.ts","line":125,"anchor":"Twin: serial-read-loop.ts:180-195 dispatchLine isolation, :99 non-fatal decoder, ADR-356 read slices, serial-wire.ts shared framing","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"TCP line delivery calls subscribers unguarded and decodes fatally: a throwing subscriber or one non-UTF-8 byte drops the read (acks included) and closes a live job's session, where USB logs and continues; no ADR-356 slicing (latent)"},
  {"id":"D7-P3-2","severity":"P3","area":"ctl-network-link","file":"src/ui/state/laser-controller-silence.ts","line":97,"anchor":"Twin: find-machine-phase.ts:151 network text; connectedBaudRate null for tcp (laser-connection-actions.ts:174)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A silent TCP controller fails qualification with 'No controller response was received at 115200 baud. Check the cable' and a 'Check baud rate (115200)' log"},
  {"id":"D7-P3-3","severity":"P3","area":"ctl-network-link","file":"src/ui/state/laser-safety-notice.ts","line":166,"anchor":"Twin: serialPortInfo.transport / lastConnectionTransport; NETWORK_RECONNECT_GUIDANCE; ADR-601 WORKFLOW step 4","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Link-loss, motion, Fire, reboot and stall notices say 'USB connection was lost' / 'check the USB link/cable' on a Wi-Fi/Ethernet session (and #1366 adds two more on main)"},
  {"id":"D7-P3-4","severity":"P3","area":"ctl-network-link","file":"src/ui/laser/MachineNetworkConnect.tsx","line":48,"anchor":"Ground truth: grblHAL telnetd.c@e0131fb2 L409-410 'Busy, refuse connection', lwIP tcp_in.c@3d896ba0 L958-965 abort, networking.h@6c297119 SOCKET_TIMEOUT 0; Twin: USB port-in-use open failure (ADR-639)","evidence":"REPRO+SOURCE","verdict":"CONFIRMED","known":false,"summary":"A grblHAL board already holding a Telnet client (another sender or a stale session after a PC crash/outage) accepts then resets KerfDesk: the form says 'TCP channel connected' and the log only 'closed unexpectedly', with no hint of the one-client rule"},
  {"id":"D7-R1","severity":"P2","area":"ctl-network-link","file":"src/ui/app/link-loss-restart-tracking.ts","line":25,"anchor":"Ground truth: grblHAL core stream.c@4ec1ae44 stream_usb_linestate_changed (welcome 200 ms after DTR, no reset), callers RP2040 usb_serial.c:318-322, STM32F4xx usbd_cdc_if.c:230-233 (+F1/F3/F7, ESP32 usb_serial.c, LPC176x); Chromium serial_io_handler_win.cc:244 DTR_CONTROL_ENABLE; Contract: ADR-398 Amd 3 Consequences 'neither resets ... shows no banner on reconnect'","evidence":"SOURCE+READ","verdict":"PLAUSIBLE","known":false,"refuter_raised":true,"summary":"REFUTER-RAISED, same fix cluster as D7-P2-1: an externally powered grblHAL native-USB board that kept running after a USB drop greets 200 ms after DTR on reopen (inside KerfDesk's 250 ms passive handshake wait), so #1366 reads it as restarted and the automatic restart re-burns up to a planner of moves; on USB a lost link is always a port close, so this is the common path; hardware timing not reproduced"},
  {"id":"D7-K-1","severity":"P3","area":"ctl-network-link","file":"electron/machine-network-bridge.ts","line":64,"anchor":"Twin remote-access/desktop.ts","evidence":"READ","verdict":"KNOWN","known":"rolling-v2 04-P3-23","summary":"Bridge session outlives a crashed/reloaded renderer for 15 s and refuses Connect"},
  {"id":"D7-K-2","severity":"P3","area":"ctl-network-link","file":"electron/rtsp-camera-bridge.ts","line":201,"anchor":"ADR-133/141/635","evidence":"READ","verdict":"KNOWN","known":"rolling-v2 04-B-1 (accepted)","summary":"Camera bridge (and /falcon/pointer) trusts any loopback http Origin in packaged builds"},
  {"id":"D7-K-3","severity":"P3","area":"ctl-network-link","file":"PROJECT.md","line":664,"anchor":"Contract: code + ADR-550","evidence":"READ","verdict":"KNOWN","known":"rolling-v2 04-P3-8","summary":"PROJECT.md desktop security paragraph omits /api/machine-network"},
  {"id":"D7-K-4","severity":"P3","area":"ctl-network-link","file":"src/ui/laser/MachineNetworkConnect.tsx","line":83,"anchor":"Ground truth: FluidNC TelnetServer::poll registers every client","evidence":"SOURCE","verdict":"KNOWN","known":"2026-07-13 cybersecurity audit (FluidNC Telnet clients without login)","summary":"FluidNC accepts concurrent Telnet senders with no login; undetectable by any sender"}
]
```
