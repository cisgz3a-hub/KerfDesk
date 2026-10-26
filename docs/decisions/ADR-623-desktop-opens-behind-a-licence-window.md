## ADR-623 - The desktop app opens behind a licence window; Free stays in the browser (2026-10-18)

**Status:** Implemented in source; reaches installed apps with the next desktop release. Decision 3 amended by [ADR-623 Amendment 1](ADR-623-amendment-1-an-admitted-session-survives-a-reload.md) (an admitted session survives a reload) and [ADR-623 Amendment 2](ADR-623-amendment-2-paid-licences-keep-working-offline.md) (a paid licence has no check-in, so it is never kept out at launch for being offline or for its clock). **Held off** by [ADR-623 Amendment 3](ADR-623-amendment-3-licence-window-held-off.md) (2026-10-21): one setting, `DESKTOP_LICENCE_WINDOW`, is off, so desktop releases from 1.0.21 open straight into KerfDesk Free until the owner turns the window back on | **Date:** 2026-10-18 | **Supersedes:** ADR-540 item 1 and the desktop half of its Free edition | **Amends:** ADR-540 items 3, 5 and 8, ADR-540 Amendment 2, ADR-592

### Context

ADR-540 made both apps open straight into KerfDesk Free, with a licence asked for
only when a Pro tool was opened. On 2026-10-18 the owner replaced that for the
desktop app: "lets remove the free tier in the electron app. They can use the free
tier on the browser app if they want to. the electron app should be like lightburn
straight to the point." He asked for a licence box at startup that "should only
disappear when the license is accepted and should block any other action".

LightBurn, the reference, opens its License and Trial window on a computer that
has never been activated. It offers a 30-day trial, a licence key and a purchase
link, and LightBurn has no free tier.

### Decision

1. **A commercial desktop build opens behind a licence window.** Until this
   device has an active trial or licence, the window shows only "Activate
   KerfDesk": start the 30-day trial, enter a licence key, buy a licence, and the
   state's own repair action (Refresh licence, Check payment, Reset saved licence,
   Retry device deactivation, manage the key's devices). It has no Close button
   and Escape does nothing. **Quit KerfDesk** is the only other way out.
2. **Nothing else runs behind it.** The workspace is not mounted until the window
   lets the device in, so the menus, shortcuts, projects (including files opened
   from Explorer, which wait in their queue), remote access, the serial port and
   the camera are all unavailable. Updates and the licence service keep working,
   because the window may need them.
3. **The window lets the device in once per session.** The first time the status
   reports Pro, the workspace mounts and stays mounted until KerfDesk closes. If
   rights end in a running session (the trial ends, a check-in is overdue, a
   refund revokes the licence, or the owner deactivates this device), the
   workspace stays open, existing work and machine control keep working, and
   ADR-540 Amendment 2 and ADR-592 still pause new Pro tool choices. The licence
   window returns at the next launch. A licence change never closes a project,
   hides Stop or stops a running job.
4. **The desktop app has no Free edition.** The status bar shows "Pro trial · N
   days left", "Pro", or "Licence needed" after rights end in a session. The
   licence panel and messages no longer promise that Free keeps working on the
   desktop. KerfDesk Free stays in the browser (ADR-544).
5. **Builds without commercial metadata do not change.** Preview, source and
   development builds cannot take a licence, so they keep running as ADR-540
   Amendment 1 describes and never show the window. A commercial build whose
   release identity does not verify shows the window with its reason and cannot
   be let in.
6. **Updates follow the licence.** A device without a licence, or whose trial has
   ended, can still update to the newest signed release from the window. A paid
   device still takes only the releases its update period covers. A newer release
   installed by hand opens to the window, which names the update date and offers
   renewal or a covered version, as LightBurn does.
7. **It is a convenience, not DRM.** The window is a renderer check over the
   main process's licence status, as ADR-523 and ADR-540 already say of the
   licence checks.

### Consequences

- Project-asset reconciliation and the page-backed raster ownership subscription
  start only with the admitted workspace, rather than during entry-module import.
  Reconciliation starts once per mounted workspace, including StrictMode effect
  replay; the ownership subscription is removed on unmount. An admitted session
  keeps these services when rights end, like the workspace itself.
- Historical installer qualification releases its developer seat before the
  uninstall-retaining-data gap, so failed retention checks or reinstall cannot
  strand a seat while no executable exists. Reopening after reinstall may
  activate again and retains the ordinary final-release and failure-cleanup paths.
- `EditionProvider` renders `DesktopLicenceGate` in place of the app until the
  first Pro status in a commercial build, and latches the session in after that.
  The main process holds its own services the same way: the RTSP camera bridge
  runs only once the current renderer acknowledges its mounted workspace after
  normalising trial expiry (always in a build without licensing). Each opening
  renderer (a reopened macOS window or a reload), a closed window and a crashed
  renderer stop it until then. The startup licence
  confirmation, which may wait on the network, queues after the window's first
  local status read, and each background confirmation signals the renderer to
  read its status again, so a restored licence opens the workspace at once.
  Periodic confirmations wait on the network outside the local record queue;
  applying a reply still serializes with local reads and explicit actions and
  discards a reply if those actions replaced its saved rights in the meantime.
- PROJECT non-negotiable 21 is unchanged: the window is not a Start guard. It
  stands before the workspace exists, and nothing in a running session gates
  Frame, Start, output or a job.
- The purchase email now points to the licence window. The website, download
  page, pricing page and FAQ change in a separate pull request, which must go live
  with the release that carries this decision, not before. The EULA and the
  website licence terms are the owner's to change.
- The native licence qualification activates from the window, not from Help >
  Licence, because an unlicensed profile no longer reaches the workspace. The
  fresh sandbox smoke now proves the window stands alone instead of importing and
  saving, and the commercial release packaging smoke
  (`build-commercial-platform.sh`, `--expect-licence-window`) does the same for
  each unlicensed Mac and Linux package. Linux keeps a licence only under a
  Secret Service or KWallet key, never Electron's fallback key, and the store
  checks which key Electron actually encrypts with, not the desktop's backend
  name (`secure-storage-check.ts`; the OpenAI key and remote-access stores use
  the same check). So that smoke launches each Linux package with an unlocked GNOME Keyring
  on its own D-Bus session and no desktop name, and it must reach
  `activation-required`. A Linux computer without a keyring sees its own message
  naming GNOME Keyring and KWallet (`MESSAGES.linuxKeyring`), not the outage
  message. It still cannot start a trial until a keyring runs: the maintainer
  chose on 2026-10-18 to keep refusing the fallback and to state the requirement
  on the download page instead. The window answers the main process's
  close requests, so Quit and the window's X close the app before the workspace
  exists. The release's historical upgrade qualification
  (`installed-upgrade-profile.ps1`), as the owner chose on 2026-10-18, opens a
  build that shows the licence window with the developer qualification licence
  (`KERFDESK_NATIVE_QUALIFICATION_LICENCE`), runs its full retention checks, and
  frees the seat in a final release phase, also after a failure. Only that child
  process receives the key, and no evidence records it.
- The startup splash fades for the settled licence window as it does for the
  painted workspace.
