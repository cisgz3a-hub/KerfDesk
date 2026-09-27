## ADR-482 - The desktop shell behaves like a desktop app (2026-09-27)

**Date:** 2026-09-27
**Status:** Implemented; software verification recorded below. Not yet tried on Windows hardware.

This builds on ADR-024 (the Windows desktop app), ADR-117 (the Electron permission allowlist) and
ADR-366 (desktop serial grants). It keeps every security
property those decisions set: no preload, no IPC, sandboxed renderer, `script-src 'self'` in the
packaged app, deny-by-default permissions, navigation locked to `app://app`. It adds no guard
(ADR-228).

### Context

The maintainer asked for an audit of the desktop app against current Electron practice
(`docs/audits/2026-09-27-electron-desktop-audit.md`). The security design held up. Launching the
real Electron 42.11.5 app showed that several things a desktop user expects did not work:

- **Outside links were dead.** Help > Report a Bug, Discussions, a CNC preset's sources and a
  library design's source are `target="_blank"` links. The window-open handler denied every
  new window except the official download link, and opened nothing instead.
- **Copy failed.** `navigator.clipboard.writeText` asks for `clipboard-sanitized-write`, which the
  permission handlers denied.
- **No right-click menu.** Electron shows no context menu unless the app builds one, so text
  fields had no Cut, Copy, Paste, Select All or spelling suggestions.
- **The window never remembered its place.** It always opened at 1280 x 800 on the main screen.
- **A renderer crash left a dead window.** The readiness policy showed an error box and nothing
  else; every control, Abort included, was gone until KerfDesk was killed.
- **Developer mode was blank.** With `LASERFORGE_DEV_URL`, Vite's React plugin injects one inline
  React Refresh preamble, which `script-src 'self'` blocks.
- **Windows taskbar identity was never set.** The NSIS shortcuts carry the app id
  `dev.laserforge.app`; Electron sets it automatically only for Squirrel installs.
- **Old event signatures.** `console-message` used the positional form Electron deprecated in 35.

### Decision

- **Outside links open in the operator's browser.** After the official-download check, the
  window-open handler passes a link to `shell.openExternal` only when `externalBrowserUrl`
  (`electron/external-links.ts`) accepts it: `https:`, a host, and no user name or password.
  `http:`, `file:`, `smb:`, `mailto:`, `javascript:`, `app:` and custom schemes are still denied,
  following Electron's checklist item "do not use `shell.openExternal` with untrusted content".
  The window itself still never opens.
- **Clipboard write is allowed for the trusted page only.** `clipboard-sanitized-write` joins the
  allowed permissions for the top frame of `app://app`. `clipboard-read` stays denied; paste
  through the keyboard and the menu does not need it.
- **A text right-click menu.** `contextMenuEntries` (`electron/editable-context-menu.ts`) turns
  Electron's `context-menu` facts into a menu: up to five spelling suggestions and "Add to
  dictionary" for a misspelled word, then Undo, Redo, Cut, Copy, Paste and Select All in a text
  field, each enabled from Chromium's edit flags; Copy alone for selected page text; nothing
  elsewhere, so the canvas keeps its own right-click.
- **The window reopens where it was left.** On close, the normal bounds and maximized state go to
  `window-placement.json` in userData (written to a temporary file and renamed). On launch the
  saved place is used only while a screen still shows 120 x 32 px of its top strip; otherwise the
  saved size, clipped to the main screen, opens centred there. A corrupt or tiny file opens the
  default 1280 x 800.
- **A crashed renderer offers a reload.** `installRendererCrashRecovery` asks "Reload KerfDesk" or
  "Not now" after any exit except `clean-exit`, keeping the instruction to use the physical E-stop
  or power cutoff. It stays silent while a close is being prepared or awaiting the page's unload
  decision (`WindowCloseGuard.isClosing()`), so the close guard's own prompt is never doubled. The
  readiness policy only makes sure the window is visible.
- **Developer mode renders.** `rendererContentSecurityPolicy` adds `'unsafe-inline'` to
  `script-src` only when the renderer URL is not `app://app/index.html`, which happens only with
  `LASERFORGE_DEV_URL` in an unpackaged app on a loopback address. The packaged policy is the
  unchanged `CSP_POLICY` literal that the web build's headers are tested against.
- **Taskbar identity.** On Windows, main calls `app.setAppUserModelId('dev.laserforge.app')`
  before any window opens. A test keeps the constant equal to `appId` in both electron-builder
  configs.
- **Current signatures.** `console-message` handlers read `{ level, message, lineNumber, sourceId }`.

The serial chooser moved from `main.ts` into `electron/desktop-serial-chooser.ts` unchanged, to keep
`main.ts` under the 400-line limit.

### Consequences

- Links in the app now leave KerfDesk and open in the default browser, as on the web build.
- The page can write text to the system clipboard. It still cannot read it without a keyboard or
  menu paste.
- A reload after a crash starts a fresh page. The job recovery flow, not this decision, decides
  what can be resumed; nothing is sent to the machine by the reload itself.
- `window-placement.json` is new state in userData. Deleting it restores the old behaviour.

### Verification

- Unit tests: `external-links.test.ts`, `editable-context-menu.test.ts`, `window-placement.test.ts`,
  `renderer-crash-recovery.test.ts`, `renderer-content-security-policy.test.ts`, and additions to
  `trusted-renderer-policy.test.ts`, `window-close-guard.test.ts`,
  `window-readiness-policy.test.ts` and `desktop-identity.test.ts`.
- The rebuilt app was launched on Linux with Electron 42.11.5 and driven with Playwright; the
  results are in the pull request.
- Not tried on Windows: the taskbar identity, the spelling dictionary download, and multi-monitor
  placement.
