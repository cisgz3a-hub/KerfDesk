## ADR-547 - Help > Check for Updates and an Update ready button in the desktop app (2026-09-29)

**Status:** Accepted | **Date:** 2026-09-29 | **Builds on:** ADR-523 (commercial updates), ADR-541 (the weekly release train and its beta ring)

### Context

The desktop gap audit of 2026-09-29 (item 5) found commercial updates nearly invisible. The app
checked once per launch, showed one Windows notification (only when notifications are on) and
installed the download the next time KerfDesk closed. There was no way to check, no status in the
app and nothing that said a new version was waiting. With the weekly release train (ADR-541) a
licensed computer can receive a new version every week.

The owner settled that licensed users update when they quit the app. Nothing here changes that,
and nothing here changes what is downloaded, verified or installed.

### Decision

1. **The update check says what it found.** `checkCommercialUpdates` in
   `electron/commercial-update.ts` returns one of: not offered (this build does not take commercial
   updates), up to date, not covered (the newest release this licence's updates do not cover),
   ready (a verified download that installs when KerfDesk closes) or not installed (a download that
   failed its checks, or whose licence changed while it downloaded). Errors still throw.
2. **One status per run of the app.** `electron/update-status.ts` keeps it: unavailable, idle,
   checking, downloading, up to date, ready, not covered or failed, with the newer version and the
   time the last check finished. One check runs at a time, and a ready update is never checked or
   downloaded again before KerfDesk closes. Preview, source, unpackaged and non-Windows builds are
   unavailable and never check. A failed check's message goes to the support log (ADR-546).
3. **Two licensing routes.** With the licensing routes' same-origin checks, `GET update-status`
   reads the status and `POST check-updates`, with an empty JSON body, starts a check and answers
   at once, so a long download never holds a request open. The window asks again every 3 seconds
   while a check or download runs, every 30 seconds before the first check starts, and stops once
   the status settles.
4. **Help > Check for Updates...** opens a panel with the version this computer runs, one sentence
   saying where updates stand, **Check now**, and the train's **Get new versions early (beta)**. A
   version the licence does not cover names the date its updates ended and says that the version
   the customer has keeps working. In the web app the command explains that the browser version
   updates itself through the status bar's Update button (ADR-227).
5. **Update ready in the status bar.** Once a version has downloaded, the status bar shows **Update
   ready**, which opens the same panel. It never restarts or closes KerfDesk.
6. The licence panel and the updates panel open in the same place, so opening one closes the other.

### Consequences

- Customers can see whether an update is waiting and check for one, and support can ask what the
  panel says.
- There are still no release notes in the app. A "What's new" needs notes published with each
  release, which the train does not do yet; that is a separate decision.
- A downloaded version still installs only when KerfDesk closes. There is no restart now,
  postpone or skip, and going back to an older version still means installing an older download.
- This decision operates no machine and changes no output. A licence or update never stops a
  running job.

### Tests

`electron/commercial-update.test.ts` covers each outcome, `electron/update-status.test.ts` the
status and both routes, `src/platform/electron/licensing.test.ts` the renderer adapter,
`src/ui/licensing/update-status-text.test.ts` every sentence and
`src/ui/licensing/CommercialUpdates.test.tsx` the panel, polling, the status bar button and the web
app's answer.
