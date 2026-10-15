# Desktop machine connections — stage 1

Work branch: `codex/desktop-machine-connections`, based on fetched `origin/main` at `f7e2a3689`. Research date: 2026-10-16 (Asia/Shanghai). See [the 18-family survey and delivery sequence](../research/2026-10-16-machine-connections.md) and [ADR-601](../decisions/ADR-601-desktop-machine-network-protocols.md).

## Delivered source

- Existing USB serial remains available. Native FluidNC and grblHAL profiles expose explicit desktop Wi-Fi/Ethernet connection forms under the machine-name dropdown.
- FluidNC retains Telnet framing. grblHAL uses a separate raw TCP channel. Both follow the existing driver and controller-session path, with explicit host/port and protocol-bound setup retries.
- Failed, cancelled and lost TCP connections do not fall back to a remembered USB port. Switching to USB uses **Use a different port…**. Addresses are not persisted; the session-only routing hint carries no target or motion permission.
- Native backpressure now bounds actual escaped output bytes and Telnet negotiation replies. The audit reproduced both old failures before fixing them: 524,289 queued bytes exceeded the 524,288 limit while the session remained open.
- Connection copy, setup transport labels, protocol inventory and operator guidance describe both supported network families. Other controllers remain on their implemented serial or file paths.

## Verification

- **Native protocol/session/route tests: 17 passed across four files.** Exact-byte loopback tests cover raw versus Telnet framing, realtime bytes, fragmented traffic, replay refusal, loss, reopening and receive overflow. Simulated backpressure checks the actual encoded-byte limit and negotiation-reply bound.
- **Connection regression coverage: 150 tests across 26 files passed across the final runs.** The broader run passed 149/150; its one failure was a DOM readiness assertion waiting inside React `act`. The test now waits for store qualification and operation completion before asserting the rendered button. All 11 tests in that affected setup suite then passed. The wider run also covers reconnect/forget ownership, teardown, remembered ports, auto-connect, diagnostics and connection controls.
- **Real native-to-renderer integration: passed after relocation to the native test area.** `electron/machine-network-renderer-integration.test.ts` exercises native routes, an actual loopback TCP socket, the renderer adapter and the real controller store. It confirms qualification/status, capability preservation after a refused USB fallback, connection loss, retained network intent and no automatic reconnect or replay. This test is included in the 150-test coverage above. Keeping it in the native area prevents Electron's DOM declarations from changing renderer-test types; Electron tests retain the repository's existing exclusion from application TypeScript/lint projects.
- **Browser UI: all four targeted scenarios passed across completed runs.** FluidNC and grblHAL setup/retry flows retain the exact protocol/target and avoid USB. Both expanded forms pass keyboard/focus and layout checks at 1280 × 620; their screenshots were visually inspected. Initial attempts timed out during workspace startup under heavy host contention, before connection assertions. The final FluidNC retry used a larger test startup allowance and passed in 1.3 minutes. This does not establish startup-performance or installed-desktop qualification.
- **Builds: Electron main and the desktop renderer bundle passed.** The renderer build reported HarfBuzz browser-externalisation and large-chunk warnings. No installer was created or installed.
- **Static checks:** renderer, browser-test and Electron application type checks passed. Scoped production Electron/renderer lint, the corrected setup-test lint, changed TypeScript/TSX formatting, file-size policy, ADR numbering and `git diff --check` passed. The final renderer check passed after relocating the native integration test; no unrelated DOM mocks or application type settings were changed.

## Boundaries and next stage

No hardware, network controller, firmware setting, provider, release or installed application was changed. Loopback fixtures contact only the local test server. These checks do not establish physical stopping, timing, machine compatibility or material quality. TCP jobs do not yet use a background worker.

Next implement the documented Smoothieware network generation as a separate adapter, then firmware-specific WebSockets. Controller storage/upload, proprietary DSP/galvo USB, Bluetooth/vendor and industrial host integrations follow the staged research plan. Each needs its own protocol and lifecycle evidence; none is advertised by this stage.
