# Machine protocol workflows: 2026-10-07

This evidence describes local source and tests in `competitive-audit-20261007`. No controller, firmware, material, provider or remote machine was operated. These are explicit protocol adapters, not a claim that every machine supports every accessory.

## Delivered operator workflows

Super Console → Machine protocol support lists the selected protocol's existing serial/file transport, status/settings/focus/probing/output support and unsupported flashing/conveyor boundaries. Declarations and same-session observations remain distinct. Read firmware report sends one owned read-only identity exchange. Firmware claims do not enable capabilities, alter controller qualification, or replace the existing strict stock-GRBL build parser.

| Selected protocol | Explicit identity query | Measured grid | Added network transport |
| --- | --- | --- | --- |
| Stock GRBL 1.1 | `$I` | With declared powered Z and probe | None |
| grblHAL | `$I+` | With declared powered Z and probe | None |
| FluidNC | `$I` | With declared powered Z and probe | Operator-entered enabled Telnet TCP channel, desktop only |
| Marlin | `M115` | Unsupported by this adapter | None |
| Smoothieware | `M115` | Unsupported by this adapter | None |
| Ruida | No report adapter | Unsupported | Existing experimental file export only |
| Vendor command-set override | No inferred report adapter | Unsupported | No inferred adapter |

Identity parsing accepts bounded known fields and omits UUIDs, build-user strings and configuration/network reports. The local diagnostic bundle includes only a current-session report, redacts field text, and retains the existing 128 KiB encoded-byte cap and explicit review/export. Reading or exporting the bundle performs no controller queries or uploads.

Super Console → Measure surface grid captures the current safe-clearance work Z, active G54–G59 and fresh WCO before motion. It rejects rotated/scaled/diameter or unsupported feed modes, missing current-session report-unit evidence, conflicting activity and unknown spindle-off evidence. The operator declares that the probe and whole travel plane are prepared. A bounded 2–20 by 2–20 grid uses a serpentine order, fast and slow confirmed contacts, and returns to the captured clearance before each XY move. Every accepted point verifies machine-coordinate `[PRB]`, report units, expected XY, Z travel, unchanged WCO and active WCS. Final completion requires two later Idle reports.

The secondary approach uses the confirmed fast work-Z contact to choose absolute endpoints. Retraction is capped at the captured clearance; the slow seek is capped at clearance minus maximum travel. Conservative 0.001 mm rounding keeps the endpoints inside that envelope, and a contact leaving no positive representable release is refused. The slow contact must also lie within its planned retouch interval. Failed contact and Abort cannot advance to another grid point.

Measured points, active coordinates, clearance and spread are locally reviewable and exportable as CSV. Alarm, Abort, connection loss or ownership/setup drift stops collection; only accepted completed points can appear in a partial review. This flow does not set Z zero, write G10/G92/work offsets, compensate output, infer focus depth or use a camera depth map. Successful collection clears the consumable run permit while retaining unchanged completed spatial Frame proof, matching the ordinary Jog contract in ADR-565. Abort/reset retains the existing evidence invalidation and recovery behaviour. No Start or output policy gate was added.

The desktop connection controls show FluidNC network connection only for its unmodified protocol and an available desktop adapter. The operator enters an IP/hostname and configured `Telnet/Port`; there is no guessed port, discovery, saved target, automatic reconnect or replay. Telnet is unencrypted and the UI directs operators to a trusted network. The TCP transport feeds the existing FluidNC driver, handshake, session ownership, Frame and Start workflows.

The native bridge owns one explicit socket, uses ordered monotonic write sequences and rejects replay or uncertain writes. It decodes segmented Telnet negotiation, preserves single-byte realtime commands, and refuses overflowing input rather than silently dropping acknowledgements. Trusted exact `app://app/api/machine-network/*` routes bound request/response sizes. Disconnect, socket loss, renderer lease expiry or committed app quit closes the socket. Host/port remain absent from serial identity, remembered USB selection and support diagnostics. Streaming is foreground renderer work; background-hosted TCP refill is not claimed.

## Primary protocol evidence

Upstream documentation/source was read on 2026-10-07. Moving branch URLs identify the inspected protocol family; no release or commit pin is claimed.

- [GRBL 1.1 commands](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands) documents read-only `$I`, coordinate queries and probe records. The `$I=...` write form is not used. [GRBL interface](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface) documents realtime status and reports.
- [grblHAL system commands](https://raw.githubusercontent.com/grblHAL/core/master/system.c) registers `I+` as extended build information. [grblHAL reports](https://raw.githubusercontent.com/grblHAL/core/master/report.c) defines extra build fields, axis and option reports, rotated WCS output and probe coordinate/report-unit behaviour.
- [FluidNC reports](https://raw.githubusercontent.com/bdring/FluidNC/main/FluidNC/src/Report.cpp) defines FluidNC version/options and probe/status output. Its option field is not assumed to contain stock-GRBL buffer capacities.
- [FluidNC Telnet server](https://raw.githubusercontent.com/bdring/FluidNC/main/FluidNC/src/WebUI/TelnetServer.cpp) exposes configurable `Telnet/Port` and `Telnet/Enable` and registers accepted TCP clients with controller channels. [FluidNC Telnet client](https://raw.githubusercontent.com/bdring/FluidNC/main/FluidNC/src/WebUI/TelnetClient.cpp) implements its Telnet channel. The adapter requires the enabled port value supplied by the operator.
- [RFC 854](https://www.rfc-editor.org/rfc/rfc854.txt) specifies Telnet IAC negotiation, refusals and escaped data. KerfDesk's independent bounded codec handles these bytes; upstream firmware code is not copied.
- [Marlin M115](https://marlinfw.org/docs/gcode/M115.html) documents firmware fields and optional `Cap:` reports. [Smoothieware dispatch](https://raw.githubusercontent.com/Smoothieware/Smoothieware/edge/src/modules/communication/GcodeDispatch.cpp) implements its comma-separated M115 fields. [Smoothieware probing](https://smoothieware.org/zprobe) and [G30](https://smoothieware.org/g30) have different coordinate/configuration contracts, so no universal grid action is inferred.

## Local verification and limits

- Firmware parser and grid math: 16 tests passed. Firmware action and grid store integration: 15 tests passed, including mm/inch reports, rotated-coordinate refusal, probe alarm, required unit evidence, Abort/disconnect containment and completed spatial Frame reuse. Independent emitted-command endpoint walks reproduced the old below-floor secondary seek before repair; floor and near-clearance fixtures now stay within the prepared 1 mm envelope. Failed slow contact and Abort during the slow contact stop further collection.
- Native Telnet/bridge/routes: 9 tests passed. Actual TCP tests connect only to an ephemeral `127.0.0.1` loopback server, exercising negotiation, boot reports, realtime byte `0x85`, sequential writes, replay refusal, channel loss, manual reopening and overflow refusal. Electron TypeScript and scoped lint passed.
- Renderer TCP transport and measured-grid UI: 5 tests passed. They cover raw-byte ordered writes, uncertainty closing, split UTF-8/CRLF, line overflow, active-dialog ownership and local CSV review. Related connection controls and diagnostic review tests also passed. The diagnostic suite additionally checks current-session report scope and target-free TCP identity.

No physical controller, installed package, background streaming, machine stop distance, collision clearance, surface accuracy or material result is qualified by these checks. Firmware installation, controller SD upload, universal autofocus, conveyor feed and automatic curved-surface compensation remain unsupported by the new adapters; they require separately documented hardware/protocol implementations and physical evidence.
