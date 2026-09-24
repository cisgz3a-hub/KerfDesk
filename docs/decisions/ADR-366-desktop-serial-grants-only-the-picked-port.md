## ADR-366 - The desktop app grants serial access only to the ports the operator picks (2026-09-24)

**Status:** Accepted. Verified against the Electron 42.11.5 source and with a no-hardware
Electron probe that opened no port. Hardware qualification remains separate (PROJECT.md,
Desktop Preview item 7). | **Date:** 2026-09-24

Makes ADR-354's identity rule work on the desktop app. It changes none of ADR-354's decisions.

### Context

ADR-354 opens the selected USB port in a dedicated worker. Web Serial identifies a port only by
its USB vendor and product IDs. So the window and the worker each require exactly one granted
port with the picked identity. With more than one, they fall back to the exact window-picked
port before any native open (decision 2).

On the desktop app every attached serial port was granted. `electron/main.ts` installed a
`setDevicePermissionHandler` that returned true for any serial device from a trusted renderer
origin. In Electron 42.11.5, once any device permission handler is installed:

- `SerialChooserContext::HasPortPermission` asks the handler about every port Electron can
  persist, instead of checking the recorded picks
  (`shell/browser/serial/serial_chooser_context.cc`). On Windows that is every port with a
  display name and a device instance ID, which includes USB serial adapters.
- `ElectronPermissionManager::GrantDevicePermission` stops recording the port chosen in the
  Select dialog (`shell/browser/electron_permission_manager.cc`).

`navigator.serial.getPorts()` therefore listed every attached adapter in the window. A dedicated
worker binds its serial service through its ancestor frame
(`content/browser/worker_host/dedicated_worker_host.cc`), so the worker's list was the same.

Two identical adapters were always ambiguous: for example, a laser controller and an Arduino that
both use a CH340 (1A86:7523). Such a connection fell back to the window port with ADR-354's "Keep
KerfDesk visible" warning. That warning is over-cautious on desktop, where the window is not
throttled while minimised (`electron/desktop-window-options.ts`). Forget Controller revoked
nothing on desktop either, because the handler granted the port again at the next check.

A probe ran Electron 42.11.5 with one USB serial device attached. It used an in-memory session
and only enumerated, granted and forgot ports. It sent the unmodified production worker bundle
(`native-serial-stream-worker.ts`) a `native-probe` message and never an open:

| Step | With the old handler | With no handler |
| --- | --- | --- |
| Before any pick: window and worker `getPorts()` | the device, in both | nothing, in both |
| Before any pick: production worker probe | `native-ready` | `native-unavailable` |
| After picking the device | the device in both, `native-ready` | the device in both, `native-ready` |
| After `forget()` | still the device, `native-ready` | nothing, `native-unavailable` |

The old handler received `{ name, device_instance_id }` as the device.

### Decision

1. The desktop app installs no device permission handler. Serial permission comes only from
   the operator's pick in the Select dialog. Electron records each pick in its own in-memory
   store:
   - On Windows it matches the pick by device instance ID. Windows builds that ID from the
     adapter's USB serial number or, for adapters without one such as the CH340, from the USB
     port it is plugged into. So two CH340 adapters get different IDs.
   - On macOS it matches by USB IDs, serial number and driver. An adapter without a serial
     number matches by the port's session token.

   The window and the worker then enumerate only the picked ports, as in Chrome.
2. Only the trusted renderer can reach the picker. `requestPort` is gated by the permission
   check handler, which grants `serial` to trusted origins only. Removing the device handler
   narrows serial access and grants nothing new.
3. ADR-354's rules are unchanged:
   - exactly one VID/PID match in both the window and the worker;
   - both sides check again before open;
   - fallback to the exact picked window port before any native open;
   - never a second owner.

   A pick lasts until Forget Controller or an app restart. Picking both identical adapters in
   one run is therefore still ambiguous, and still falls back.
4. Forget Controller's `port.forget()` now revokes the desktop grant, as ADR-354 decision 3
   assumes.

### Consequences and verification

- With a laser and an identical second adapter attached, desktop background streaming now runs
  in the worker for the picked adapter instead of falling back.
- Picks do not survive an app restart. Every Connect already goes through the Select dialog, and
  nothing reconnects from `getPorts()` without it. The only other caller, the stale-port sweep
  before the picker, needs only ports this run opened.
- `electron/trusted-renderer-policy.test.ts` pins that `electron/main.ts` installs no device
  permission handler.
- `src/platform/web/native-serial-identical-adapters.test.ts` connects to one of two identical
  adapters under both grant models. It runs the production `webSerial` adapter, a worker
  boundary on a real `MessageChannel` and the real native runtime:
  - With only the pick granted, the worker opens the picked adapter, streams to it and never
    opens its twin. Forget revokes the picked port only.
  - With every port granted, the exact picked window port opens and no worker starts.
  - With the uniqueness checks removed, the second case opens the twin in the worker instead.
- Not verified: two identical adapters physically attached (only one serial device was
  available), a port opened or a job streamed on hardware, and the macOS Preview.
