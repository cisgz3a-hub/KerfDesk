## ADR-601 — Explicit desktop machine network protocols

**Status:** Implemented for local software verification, 2026-10-16. The maintainer requested research and staged development of broad desktop machine connectivity. Installed-package and physical-machine qualification remain separate.

## Context

USB serial and the explicit desktop FluidNC Telnet channel already exist. Wi-Fi and Ethernet are physical network links, not controller command protocols. In particular, grblHAL's networking plugin documents raw Telnet and passes socket payload bytes directly into its controller stream. FluidNC's channel handles Telnet framing. Sharing a TCP port does not make those wire contracts interchangeable.

The [connection survey](../research/2026-10-16-machine-connections.md) covers the other major families and the next stages. Adding an unverified generic network option for every controller would misrepresent support.

## Decision

The desktop network adapter accepts two explicit contracts: `fluidnc-telnet` and `grblhal-raw`. The former retains RFC 854 framing; the latter preserves raw bytes without IAC escaping, filtering or negotiation. The native route validates the protocol before opening a socket. Both use the established controller driver, handshake, stream accounting and disconnect lifecycle. No firmware command, output dialect, Frame or Start policy is added or changed.

Machine details exposes the matching network form only for a native FluidNC or grblHAL profile without a vendor command-set override. The operator supplies the actual host and enabled port. Wi-Fi and Ethernet share this form; there is no guessed port, scan, saved address, automatic reconnect or command replay. Setup retries retain the captured target and protocol. Changing the setup draft to a different controller cannot reinterpret that target. Closing setup drops its target. Switching the visible controller family resets an unfinished network form.

A session-only `lastConnectionTransport` routing hint survives connection failure, loss and explicit disconnect. After a TCP attempt, ordinary Reconnect and USB auto-connect cannot silently select a remembered USB machine. The operator uses the network form again, or explicitly chooses **Use a different port…** to switch to USB. Cancelling that picker retains the hint. Forget Controller or restarting the app clears it. This hint contains no address and grants no motion authority; network targets never become remembered USB identity or diagnostic target details.

Native transport retains one session, bounded receives, monotonic writes, uncertain-delivery shutdown and renderer leases. The output bound counts encoded wire bytes and applies to Telnet negotiation replies as well as commands. This closes two independently reproduced holes in the original bound. TCP streaming remains renderer-driven; background worker refill is not claimed.

## Evidence and limits

Primary references inspected on 2026-10-16:

- [grblHAL networking](https://github.com/grblHAL/Plugin_networking) documents raw Telnet and board-dependent network services. [telnetd.c](https://raw.githubusercontent.com/grblHAL/Plugin_networking/master/telnetd.c), identifying itself as v2.6 / 2026-03-30, registers the controller stream and feeds received bytes into it. These are inspected moving source references, not a claim that every installed firmware uses this revision.
- [FluidNC Telnet client](https://raw.githubusercontent.com/bdring/FluidNC/main/FluidNC/src/WebUI/TelnetClient.cpp) implements the separate Telnet channel; [server](https://raw.githubusercontent.com/bdring/FluidNC/main/FluidNC/src/WebUI/TelnetServer.cpp) defines enable/port settings.
- [RFC 854](https://www.rfc-editor.org/rfc/rfc854) defines Telnet framing. No external implementation was copied and no dependency was added.

Required evidence is exact-byte loopback transport, raw versus framed mode isolation, backpressure and loss tests, real-store handshake integration, setup Retry and wrong-family containment, USB fallback prevention, responsive keyboard-accessible UI, and renderer/Electron type/build checks. Results are recorded in [the implementation record](../implementation/2026-10-16-machine-connections.md).

This stage does not implement Smoothieware network, WebSocket, storage upload, discovery, Bluetooth-specific, Ruida live, proprietary USB or vendor-cloud adapters. Those remain separate steps in the survey. No controller, firmware setting, installed desktop or physical machine is qualified by software tests. The unchanged ADR-565 Frame contract applies.
