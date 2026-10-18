## ADR-623 - The desktop app opens behind a licence window; Free stays in the browser (2026-10-18)

**Status:** Implemented in source; reaches installed apps with the next desktop release | **Date:** 2026-10-18 | **Supersedes:** ADR-540 item 1 and the desktop half of its Free edition | **Amends:** ADR-540 items 3, 5 and 8, ADR-540 Amendment 2, ADR-592

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

- `EditionProvider` renders `DesktopLicenceGate` in place of the app until the
  first Pro status in a commercial build, and latches the session in after that.
  The main process holds its own services the same way: the RTSP camera bridge
  starts once the licensing routes first send the renderer a Pro status (at once
  in a build without licensing), and the startup licence confirmation, which may
  wait on the network, queues after the window's first local status read.
- PROJECT non-negotiable 21 is unchanged: the window is not a Start guard. It
  stands before the workspace exists, and nothing in a running session gates
  Frame, Start, output or a job.
- The website, download page, pricing page, FAQ and licence emails still describe
  a desktop Free edition. They must change before the release that carries this
  decision. The EULA and the website licence terms are the owner's to change.
- The native licence qualification activates from the window, not from Help >
  Licence, because an unlicensed profile no longer reaches the workspace. The
  fresh sandbox smoke now proves the window stands alone instead of importing and
  saving, and the commercial release packaging smoke
  (`build-commercial-platform.sh`, `--expect-licence-window`) does the same for
  each unlicensed Mac and Linux package. The window answers the main process's
  close requests, so Quit and the window's X close the app before the workspace
  exists. The historical Free upgrade qualification (`installed-upgrade-profile.ps1`)
  still expects a Free workspace: once its target carries this decision, it needs
  a licensed profile.
- The startup splash fades for the settled licence window as it does for the
  painted workspace.
