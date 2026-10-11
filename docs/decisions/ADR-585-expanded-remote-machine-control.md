## ADR-585 - Expanded remote machine control and the PC-side hold-to-jog dead-man

**Status:** Accepted for the maintainer's explicit approval on 10 October 2026 ("build ... all that needs extra approval"), covering the machine-control expansion that ADR-569 and the KerfDesk Remote brief reserved for a separate decision. Extends ADR-569. Simulator and source evidence only; no hardware was operated.

**Context.** Control-approved clients could make discrete jogs, Frame, Review, Start and Abort. Operators asked to connect, home, set the origin, pause/resume, hold-to-jog, see the camera and follow job progress from the phone. Continuous motion over a network is the riskiest of these: a lost release message must not leave the machine moving.

**Decision.** Control-scope connections gain these commands. Each calls the existing desktop action and keeps the durable action ledger, UUID identity, `expectedRevision` (except where noted) and operation receipts of ADR-569. None composes G-code.

| Command | Desktop action and guards |
| --- | --- |
| `connect_machine` | `connect(platform, {...connectOptionsForDevice(device), portSelection: 'automatic'})`. Never opens a port picker or reports port names; without a remembered port it refuses and asks the operator to connect once on the PC. File-only profiles keep their refusal. |
| `disconnect_machine` | `disconnect()`; refused while a job or motion is active. |
| `home_machine` | `home()` with every existing guard (Idle/Alarm state, MPG, pending writes, homing support). |
| `set_work_origin` (`xy` or `z`) | `setOriginHere()` or `zeroZHere()`; no motion. |
| `pause_job`, `resume_job` (no revision) | `pauseJob()`/`resumeJob()` with their controller confirmation, laser-mode and door rules. |
| `jog_hold_start`, `jog_hold_stop` | Hold-to-jog; see below. Phone only. |
| `get_camera_snapshot` (read) | `captureSourceFrame` of the live PC camera, encoded as one JPEG of at most 1024 px and 240,000 base64 characters. Requires control scope and the artwork-sharing opt-in; no camera URLs or credentials are returned. |

`get_machine_status` adds hold support, homing state, camera availability, elapsed and remaining job time, and per-action availability reasons. Job alerts (ADR-583) report kind only.

**Hold-to-jog dead-man.**

- Offered only when the desktop's own hold is offered: the controller reports a realtime jog-cancel byte (`capabilities.jogCancel`).
- One hold is a single bounded jog: at most 100 mm on X/Y (the existing remote step bound) or 20 mm on Z, at the desktop's clamped jog feed. Releasing early stops it; reaching the bound ends it.
- The dead-man lives in the PC renderer. `jog_hold_start` arms a 600 ms timer. The phone sends heartbeats over its live socket (ADR-582) about every 150 ms. Electron main forwards them only for a client that currently holds control approval and a live lease, and the renderer polls every 80 ms while a hold is active. A late heartbeat, `jog_hold_stop`, the phone socket closing, losing the relay connection, revocation, lease expiry, Abort or renderer replacement each call the existing `cancelJog()` (GRBL `0x85`), and only for the motion this hold owns on the same controller session.
- Hold commands require the phone transport with a live socket. The MCP server does not register them, and the relay refuses them on `/mcp`. `jog_hold_stop` uses the reserved Abort lanes on the relay and desktop.

**Unchanged.** Frame-first Start (ADR-565), exact review confirmation, the Pro rule, and the exclusions of raw console/G-code, arbitrary laser firing, shell and file access. Network Abort and the dead-man are software controls, not an emergency stop.

**Consequences.** Each hold uses two ledger actions; ADR-569's 4,096-action bound per lease still applies, so heavy use of a remembered phone may need a fresh pairing. Heartbeat timing was chosen from the desktop's 80 ms hold poll and typical relay latency; it must be measured on real networks and hardware before release claims. Simulator tests cover cancellation paths only.
