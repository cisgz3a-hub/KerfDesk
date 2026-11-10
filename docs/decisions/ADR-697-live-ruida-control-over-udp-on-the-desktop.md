## ADR-697 - Live Ruida control over UDP on the desktop (2026-11-10)

**Status:** Accepted. Extends ADR-097 (Ruida `.rd` export, `transport: 'file-only'`). Revises the
`PROJECT.md` follow-up order "Ruida real-controller validation then the Electron UDP transport".
Keeps PROJECT.md non-negotiable 21 and ADR-565 (frame-first Start) unchanged. **Simulator-tested
only; not qualified on a real controller.** | **Date:** 2026-11-10

### Context

A competitor scorecard rated KerfDesk's laser-controller coverage 6/10 against LightBurn's 10 because
Ruida, the controller in most CO2 lasers, was export-only: save an `.rd` file, carry it to the
machine. ADR-097 left a pure UDP session state machine (`ruida-udp-session.ts`) as groundwork, and
`PROJECT.md` ordered "real-controller validation, then the Electron UDP transport". The maintainer
asked for every gap on the scorecard to be built. That request authorises building the transport
before a real controller has accepted a file; this ADR records that and labels the result
simulator-only.

The line-based controller store (`laser-store.ts`) speaks G-code lines and realtime bytes. A Ruida
speaks swizzled binary commands in datagrams, each answered by one verdict byte. Teaching the line
store a second grammar would touch every Start, Frame, recovery and qualification path the GRBL
family relies on. The browser has no UDP at all.

### Primary sources

meerk40t at `d511944e08788e88077727f682957759884ff5ca` (`meerk40t/ruida/`), read for this decision:

- `udp_transport.py` L17-18: datagrams go to the controller's port 50200; the host binds 40200 for
  replies. L22-23 name 50207/40207 for the panel keys (`INTERFACE_*`), which this ADR does not use.
- `ruidasession.py` L286-411 (`_ruida_handshaker`): one datagram at a time; wait for its ACK (0xCC),
  resend on NAK (0xCF), treat ENQ (0xCE) as a keepalive; a `DA 00` read is followed by one more
  datagram carrying the reply; a reply that arrives while an ACK is awaited stands for it; after its
  receive tries the session gives up and marks the link failed.
- `rdjob.py` L131-134: `D8 00` Start, `D8 01` Stop, `D8 02` Pause, `D8 03` Restore Process. L169:
  `GET_SETTING = DA 00 <memory(2)>`. L225-242: `MEM_MACHINE_STATUS = 04 00` with the bits identified
  so far — `0x01000000` Moving, `0x00000002` Part end, `0x00000001` Job running ("Status bits
  identified so far"; no paused bit) — and `MEM_CURRENT_X/Y = 04 21 / 04 31`. L1332-1361
  (`decode_reply`): a reply is `DA 01 <memory(2)> <value(5)>`, unswizzled whole.
- `controller.py` L412-422: `abort`, `pause` and `resume` each send their process command as a
  standalone write; L142-189 poll `STATUS_ADDRESSES` every 0.2 s; L83-94 send a job in chunks.

### Decision

1. **A separate link and store.** The desktop main process owns a UDP socket
   (`electron/ruida-network-bridge.ts`, `-session.ts`, `-routes.ts`) reached from the sandboxed
   window over `app://app/api/ruida-network/{open,read,write,close}`, guarded like the TCP routes
   (exact app URL, the `X-KerfDesk-Ruida-Network` header, same origin). The window's link
   (`platform/electron/desktop-ruida-network.ts`) carries datagrams only. A Ruida network store
   (`ui/state/ruida-network/`) drives `ruida-udp-session.ts` over it. The line store still sees Ruida
   as `transport: 'file-only'`, so its Connect, jog, console and Start stay off exactly as before.

2. **Only what a public source documents.** The driver's new `datagramNetwork` capabilities
   (`RUIDA_NETWORK_CAPABILITIES`) list Start (stream the encoded `.rd`), Frame, Pause (`D8 02`),
   Resume (`D8 03`), Abort (`D8 01`) and status (`DA 00` reads of the status bits and X/Y). Jog,
   home, console, settings, origin and overrides stay off. The panel mounts only these controls and
   only when the platform has a Ruida link and the driver lists the capability (no `kind` check,
   ADR-094).

3. **The target is a private IPv4 literal.** The bridge accepts only an IPv4 address that
   `private-network-host-policy.ts` allows (loopback and RFC 1918, as the camera bridge). Replies are
   heard only from that address and port 50200, so another host on the network cannot answer for
   the controller. No hostnames, no discovery, no auto-reconnect. One session at a time; a program
   already holding port 40200 (LightBurn, RDWorks) makes Connect fail with that explanation.

4. **One datagram in flight; nothing resent after a missed verdict.** The exchange follows
   meerk40t's handshake. A NAK resends the same datagram up to three times; a missing verdict after
   1 s of the window's own running time (`runningTimeDeadline`, ADR-356 Amendment 2) fails the
   exchange without a resend, because UDP has no sequence numbers and a lost ACK would otherwise run
   the same commands twice. When a job or frame stream fails part-way, the store sends Stop Process
   at once: the controller may already be running what it received. The main process numbers the
   window's writes and closes a session on a repeated or out-of-order one, with Stop Process.

5. **Frame is a travel-only job; Start needs it.** meerk40t documents no host-driven frame command
   (the panel's Frame key frames the file the controller holds). The Frame is therefore an `.rd`
   job written by the same writer, with the job's reference-point mode and header bounds, whose
   only moves are `0x88` Move Absolute around the bounds at zero power and with air off. Start runs
   only when the last Frame completed on this connection traced the same footprint (bounds and
   reference mode) — non-negotiable 21 and ADR-565 unchanged. A Frame counts as completed only
   after the controller reported busy at least once and then idle twice in a row. Start streams the
   exact bytes Save `.rd` writes for the same placement; its advisories are shown as warnings and
   never refuse. A controller that reports itself busy, or does not answer a status read, is sent
   nothing: it factually cannot take the job.

6. **Placement.** Absolute, User Origin and Verified Origin compile as Save `.rd` does. Current
   Position needs the head position, which this link does not read back as a placement input, so it
   is refused with that reason; Save `.rd` still exports it.

7. **Stops the window cannot send.** As for the TCP sessions (rolling audit v11 W3-P1-1), the main
   process sends Stop Process on every Ruida session the window can no longer reach: a crashed
   renderer, a window whose reads stopped for the 15 s lease, the app quitting, and Windows ending
   the session (`desktop-machine-stop.ts` joins both bridges). A Ruida runs a job from its own
   memory, so closing the socket alone stops nothing. UDP gives no proof of arrival; the result
   counts datagrams the OS took. Disconnect during a job sends Stop Process first; the window's own
   Close after that sends none.

8. **Unchanged.** `.rd` export, the encoder's bytes and golden files, the browser build (it has no
   `ruidaNetwork` adapter), Job Review, and the line store's frame-first Start.

### Evidence

- `src/__fixtures__/controllers/ruida-udp-simulator.ts`: a scripted controller that checks each
  datagram's checksum, answers ACK, NAK, ENQ, a lost ACK or a dropped datagram per script, decodes
  each complete file with this repo's `.rd` decoder, runs it for a scripted number of status reads,
  and takes Stop, Pause and Restore.
- `ruida-network-store.test.ts` drives the real store over it: Start refused without a Frame and
  after the job moves; the Frame has no cut and five travel moves; Start sends bytes that decode to
  the Save `.rd` file; NAK resend; four NAKs fail with Stop Process; a lost ACK fails without a
  resend and with Stop Process; ENQ is no verdict; Pause/Resume; Abort mid-send sends no further job
  datagram before Stop Process; an unacknowledged Stop says to use the panel; Disconnect stops a
  running job; a dropped link says a held job keeps running.
- `electron/ruida-network-bridge.test.ts` runs the real bridge against a loopback UDP socket:
  traffic both ways, other ports ignored, no replay, the reply-port conflict message, Stop Process
  on a renderer crash, on `stopAll` and on lease expiry, none on the window's own Close, the route
  guards, and the main-process Stop Process datagram equal to the core one for every magic.

None of this is evidence that a real Ruida accepts these datagrams or this `.rd` file.

### Consequences

- KerfDesk can stream, frame, pause, resume and stop a Ruida from the desktop app over Ethernet or
  Wi-Fi, labelled experimental and not qualified in the panel, `PROJECT.md` and the README.
- Real-controller validation is still owed and is now the first Ruida follow-up: confirm the
  verdict bytes, the status bits during a job and while paused, that a streamed file runs, and that
  the travel-only Frame traces where the job burns, on an RDC644x-class controller.
- The swizzle magic is fixed at `0x88` (RDC644x). meerk40t notes `0x11` for the 634XG; the link
  takes a magic parameter but the panel does not offer a choice until a controller needs it.
- Jog, home, origin and the panel keys on port 50207 remain unbuilt until a source documents them
  well enough.
