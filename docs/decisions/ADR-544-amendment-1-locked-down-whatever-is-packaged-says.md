## ADR-544 Amendment 1 - A build that sells licences stays locked down whatever `app.isPackaged` says (2026-09-29)

**Status:** Accepted | **Date:** 2026-09-29 | **Amends:** ADR-544 item 2

### Context

A re-audit of the desktop app before it merged found that ADR-544's refusal of
remote debugging, and the main process's DevTools and development-renderer
switches, all asked Electron's `app.isPackaged`. Electron answers that from the
executable's name alone: a copy named `electron` (`electron.exe` on Windows)
counts as unpackaged. KerfDesk installs for the current user (ADR-545), so its
folder is writable without administrator rights. A copy of `KerfDesk.exe` renamed
`electron.exe` beside the original still loads the integrity-checked `app.asar`
and keeps every fuse, which live in the executable, but:

- `refusedDebugSwitch` let `--remote-debugging-port` through, so Chrome DevTools
  could attach to the renderer and switch Pro on without changing a file;
- `shouldEnableDesktopDevTools` enabled DevTools in the window, and
  `installDevTools` opened them;
- `resolveRendererRuntime` honoured `LASERFORGE_DEV_URL`, so the window would load
  its renderer from a local server of the copier's choosing.

### Decision

1. `electron/main.ts` reads the packaged licensing metadata once, before any
   window, route or single-instance handoff: `SELLS_LICENCES` is anything but a
   plain free build, so malformed metadata counts, as before.
   `LOCKED_DOWN = app.isPackaged || SELLS_LICENCES`.
2. `refusedDebugSwitch` (`electron/debug-switch-policy.ts`) refuses the
   remote-debugging switches whenever the build sells licences. It no longer asks
   whether the build is packaged.
3. DevTools, the renderer console forwarding and the development renderer
   (`LASERFORGE_DEV_URL`) are off whenever `LOCKED_DOWN`.

### Consequences

- A renamed copy of a commercial build behaves exactly like the installed one.
- Free, Preview and development builds are unchanged: they carry no commercial
  metadata, so `LOCKED_DOWN` is `app.isPackaged` for them, and running from the
  repository still opens DevTools and the development server.
- `electron/debug-switch-policy.test.ts` checks the refusal without a packaged
  flag and pins the wiring in `main.ts`; `electron/application-menu-policy.test.ts`
  pins the DevTools switch.
- This changes nothing a licence gates and no machine output.
