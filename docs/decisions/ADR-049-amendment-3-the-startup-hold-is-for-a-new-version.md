## ADR-049 Amendment 3 - The startup hold is for a new version; other launches reveal on paint (2026-11-11)

**Status:** Implemented. | **Date:** 2026-11-11

### Context

Amendment 2 holds the startup screen for four visible seconds and a 750 ms fade on every
launch and every reload, in both editions, with the workspace inert and every key press
swallowed. The user annoyance audit of 2026-11-11 (finding A5-D-1) measured that as about
4.75 seconds of blocked input each time the app opens, even when the workspace painted long
before. The hold was the maintainer's own request, so the audit raised it as a decision
rather than a defect. The maintainer approved the change below on 2026-11-11.

### Decision

The four-second visible hold of Amendment 2 applies to the first launch of each app version
on a device: a fresh install, or the first launch after an update. On every other launch and
on every reload the splash starts its fade as soon as the workspace canvas, or the settled
licence window, has had its paint opportunity.

- The version is the build's `__APP_VERSION__`, the one About and the updater show. The web
  app uses only its major.minor part, because the last part is a commit count. The
  version that has had its hold is kept in localStorage under
  `kerfdesk-startup-splash-held-version-v1`.
- The record is written when the hold completes, not when it starts. A first launch that is
  reloaded, closed or replaced by a crash screen before the hold is served holds again next
  time.
- Every storage read and write is guarded. When storage cannot be read or written, no launch
  can be told from the first, so no launch holds. A store that reads but refuses writes is
  found by a trial write before the hold starts, so it cannot hold on every launch.
- No minimum is added to the ordinary launch. The splash is the document's first paint and
  stays through the whole bundle load, and the 750 ms fade is kept, so it dissolves rather
  than blinks. Under reduced motion it is removed without a fade, as before.
- Everything else in Amendment 2 stands: the embedded artwork, the 750 ms fade, the fade
  waiting for a successful paint, the five-second missing-workspace fallback, a root startup
  error shown at once, the desktop's native visibility counting during a hold, and input
  returning at the moment the splash is removed and not earlier.

### Consequences

A returning user reaches a working workspace as soon as it has painted, about four seconds
sooner than before. A new install and each update still present the complete timber screen
for the full hold, once per device. The desktop app's version is its release number, so it
holds once per release. A web build's version ends in the commit count
(`src/platform/web/build-info.ts`), which changes with every deploy, so the web app keys the
hold on major.minor (`splashHoldVersion`): it holds on a first visit and when the major or
minor number changes, and a deploy alone does not hold. Clearing site
data, a new browser profile and a private window count as a first launch. Browser specs
start from a fresh context, which is a first launch, so their first navigation still holds
in full and the shared Playwright fixture still waits for the splash to be removed; later
navigations in the same context are released on paint. No machine, output, licence, startup
interaction or publication policy changes.
