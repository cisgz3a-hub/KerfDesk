## ADR-117 Amendment 1 - A browser tab hidden during a job is told it lost its keep-awake, and a browser Start says so first (2026-11-09)

**Status:** Accepted; unit evidence with a Wake Lock double modelled on the W3C spec, not run on a
real job. | **Date:** 2026-11-09

Fixes rolling audit v11 finding W9-P2-1 (`docs/audits/2026-11-08-rolling-v11/W9-platform-web-docs.md`,
ledger row in `LEDGER.md`). Amends the Decision's lifecycle and failure rules for the browser build.
The desktop app is unchanged: it keeps its page visible while minimised (ADR-354 Amendment 1,
ADR-362), so it never sees a hidden page.

### Context

- The W3C Screen Wake Lock draft (WD 2026-09-29) releases every screen lock when the page becomes
  hidden, and `request()` rejects with `NotAllowedError` while it is hidden. A page is hidden in a
  background tab or a minimised window. The refuter measured Chrome 156: the OS power request drops
  from `0x2` to `0x0` when the tab is hidden.
- `use-active-job-wake-lock.ts` returned before asking while hidden, so the "Keep-awake unavailable"
  line this ADR requires never appeared. It re-acquired the lock when the page was visible again,
  but said nothing in between.
- Nothing else keeps a browser PC awake: this ADR has no `powerSaveBlocker`, and Windows does not
  count serial traffic as activity. The computer can idle-sleep, the stream stops, and a GRBL-family
  controller under `M3` keeps the beam lit over the stopped head (ADR-676).
- Other web-serial senders: none we found documents anything beyond the Wake Lock API, which every
  browser drops for hidden pages. Desktop senders block sleep natively (gSender, for example), which
  a page cannot do. So the browser build can only tell the operator.

### Decision

1. **Hidden during a job is reported, not silently waited out.** While a job is active
   (`isActiveJob`), the page becoming hidden, or a job starting while the page is already hidden:
   - adds one Laser log line per job: "Keep-awake paused: KerfDesk is in a background tab or
     minimised window, so the browser released its keep-awake. If the computer sleeps, the job stops,
     and a constant-power (M3) beam stays on over the stopped head. Bring KerfDesk back to the
     front, or turn off sleep in your power settings.";
   - prefixes the tab title with "⚠ Keep visible — " for as long as it stays hidden, so the tab
     strip shows it;
   - and, when the page is visible again, shows a warning toast (one keyed slot) saying KerfDesk was
     in the background during the job and to keep the tab in front or turn off sleep.
   The title mark goes when the page is visible, the job ends or the hook unmounts. A hidden page no
   longer asks for a lock it cannot get, and the "Keep-awake unavailable" line keeps its own meaning
   (no API, or a refusal while visible).
2. **The lock is asked for again when the page is visible** (unchanged).
3. **A browser Start says it first.** Job Review for a Start on a connection opened in the browser
   build (`connectionHost === 'web'`, recorded at connect beside `jobStreamHost`) adds an advisory
   warning: keep KerfDesk in front until the job ends, because a background tab or minimised window
   lets the computer sleep, which stops the job with a constant-power beam on; for long jobs, turn
   off sleep or use the desktop app. It shows on the phone remote with the review's other warnings.
   Advisory only, never a Start gate (ADR-565, ADR-228 rule 7).
4. **Help says it too.** Help > Can't connect? "DISCONNECTS DURING A JOB?" gains the browser line.

### Consequences

- A browser operator learns before Start, while it happens (title), and afterwards (toast and log)
  that a hidden tab lets the computer sleep. The app still cannot keep it awake; the cure is the
  operator's power settings, the foreground tab or the desktop app.
- Every return to the tab during a job shows the toast, even after a few seconds away. That is
  deliberate: the risk does not depend on how long the tab was hidden.
- No change to streaming, the watchdog, G-code, Frame, Start or the desktop app.

### Verification

`use-active-job-wake-lock.test.ts` runs the real hook and laser store against a page double whose
wake lock releases on hidden and rejects while hidden: one log line per job, the title mark while
hidden, a toast on return, re-acquisition when visible, a job started while hidden, and the job
ending while hidden. `browser-keep-awake-warning.test.ts` pins the Job Review warning to browser
connections only. **Not verified:** a real hours-long browser job with sleep armed; the refuter's
`power-state.ps1` (coordinator scratchpad `zz-w9r`) can confirm the OS side on one. Hardware was
not used.
