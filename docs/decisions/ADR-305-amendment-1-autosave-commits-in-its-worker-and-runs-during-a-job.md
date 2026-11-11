## ADR-305 Amendment 1 - The interval autosave commits in its worker, runs during a job, and a failed autosave stays visible (2026-11-11)

**Status:** Accepted; unit evidence, and a Chrome measurement against a simulated GRBL job on the
window route (Vite dev build). No hardware, packaged desktop app or production build was run. |
**Date:** 2026-11-11

Follows user annoyance audit A1 findings A4-P2-1 and A5-P2-1
(`docs/audits/2026-11-11-annoyance-a1/REPORT.md`). Amends Decisions 2, 3 and 7. The method and
every number are in `docs/audits/2026-11-11-annoyance-a1/F5-fix-autosave.md`.

### Context

- The interval loop skipped every tick while a job was streaming or paused
  (`autosave-loop.ts`, `use-autosave.ts`). Work drawn during a two-hour engrave had no recovery
  copy. No ADR recorded the rule, WORKFLOW F-C3 said "every 30 s" without it, and one sentence in
  Settings disclosed it.
- The rule's stated reason was that the interval write must not disturb the UI thread during a
  job. The audit took that reason to be out of date since the autosave worker (ADR-346, ADR-598).
  It was not. The worker serialised and validated the project, but the IndexedDB commit of
  Decision 2 ran on the window:
  - the version check read both earlier snapshots back and parsed each in full;
  - the worker's reply carried the whole project text to the window, and the commit copied it
    again.
- Measured on the window while a simulated job streamed: the longest task of one autosave was
  146–153 ms at 10,000 objects, 219–626 ms for a 1,000,000-point trace and up to 892 ms for one
  12 MP photo. On the window route the controller is not refilled, and Abort is not sent, during
  such a task. Every interval paid this, job or not, from the second write of a session on.
  Performance audit S3 measured the first write, which has no earlier snapshot to read.
- Moving the commit into the worker was not enough. The two parses then ran in the worker with a
  578 MB heap, and on a PC short of memory whole-machine stalls of 70–213 ms followed large
  autosaves: every Chrome process stopped, not only the UI thread.
- A failed autosave raised one toast for each cause in a session and left no other sign. A user
  who looked away worked on unprotected and was not told again. Machine settings that could not be
  saved for the next session did the same.

### Decision

1. **The worker that prepares the record commits it.** The window hands the project to the
   worker, reads the slot's epoch as before, and sends that epoch. The worker runs Decision 2's
   transaction against the same database and answers "committed" or "conflict". The compare-and-swap
   epoch, the single service queue of Decision 3 and the session locks of Decision 4 are unchanged
   and stay on the window.
   - The project text returns to the window only when the commit fails and the localStorage
     fallback of Decision 6 needs it.
   - A version refusal from the worker is rebuilt as the same error on the window, so the session
     rotation that preserves a newer build's record still happens.
   - The worker keeps its memory-lane reservation (ADR-288 Amendment 3) until the commit answers.
     A worker that does not answer within 60 seconds is retired and the write fails.
   - A browser without workers, and a service given its own repository (tests), commit on the
     window as before.
2. **The version check reads the head of the text.** A snapshot this build wrote starts with
   `{"schemaVersion":N`. When N is the current project schema version the snapshot is supported,
   and its text is not parsed. Text that starts any other way, or with another version, is parsed
   and judged as before. This applies to every commit and clear, on either thread.
3. **A job no longer switches autosave off.** While a job is streaming or paused, the 30 s loop
   writes when all three of these hold:
   - **The project is light.** Its weight is estimated before each write: 1 for each character of
     embedded text, 64 for each vertex, 4,000 for each scene object. The limit is 30,000,000. The
     weight bounds two things: the hand-off, which is the only part of an autosave that still
     grows with the project on the UI thread (packing the geometry, ADR-346, and the structured
     clone inside `postMessage`), and the size of the copy the worker holds in memory. One 12 MP
     photo, a 400,000-point trace and 2,000 objects pass; 10,000 objects, a 1,000,000-point trace
     and four 12 MP photos do not.
   - **No hand-off measured during this job took more than 30 ms.** The estimate is a model; this
     is the machine it runs on. One slow hand-off ends autosave until the job ends.
   - **The last write reached IndexedDB.** The localStorage fallback writes the whole project text
     synchronously on the UI thread.
4. **A project that does not pass waits for the job to end**, as every project did before. The
   interval stays 30 s. The loop's synchronous default writer never runs during a job.
5. **The status bar keeps saying what a toast said once.** In its fixed action rail, shown only
   while it applies:
   - **Autosave failed**, from a failed write until the next write that succeeds, or until the
     project is saved to a file;
   - **Autosave waiting for job**, while Decision 4 holds a write back;
   - **Machine settings not saved**, from a failed save of the machine profile until a later
     change is saved.

   The tooltip gives the cause and what to do, and the sign is focusable and announced. The toasts
   are unchanged: once for each cause.
6. **The close copy is unchanged.** `beforeunload` still writes synchronously to localStorage,
   whatever the job or the gate says, and ADR-688 Amendment 3 still marks the copy written after
   Don't Save.

### Consequences

- Work drawn during a job has a recovery copy at most 30 s old, for projects within the limit.
- On the final build no autosave in the measurement produced a long task, during a job or not.
  For projects let through during a job (39 timed writes):
  - the hand-off took 0.5–16.9 ms;
  - the gap between the controller's acknowledgements was 7–34 ms, against 19–23 ms with no
    autosave, and the stream held 295–305 acknowledgements a second against 300;
  - a key press waited 1–29 ms for its handler, against 1–9 ms;
  - Ctrl+. reached the simulated controller 7–10 ms after the press with autosaves running back
    to back, against 9–12 ms with none.
- A project over the limit is still unprotected while a job runs. That is now said in the status
  bar instead of only in Settings.
- Every autosave is cheaper, job or not: the 1,000,000-point trace took 2.7–3.0 s in the worker,
  from 4.2–11.8 s, and nothing over 50 ms on the window, from 219–626 ms.
- The worker's heap lives a little longer (through the commit), so a background preparation that
  autosave preempted restarts that much later.
- The weight estimate walks each scene object once and remembers the result for as long as the
  object exists. An edit re-weighs only what it replaced.
- A snapshot whose text does not start with its schema version (none this app writes) still costs
  a full parse.
- No change to the snapshot format, the IndexedDB schema, recovery, Frame, Start, G-code or
  licensing.

### Verification

- `autosave-worker-commit.test.ts` runs the real worker module behind a stand-in Worker that
  structured-clones every message, against one fake IndexedDB shared with the window's service:
  the project text never returns on a good commit; the epoch stays in step across writes and a
  clear; a moved slot is superseded; a failed commit takes the record back for the fallback; a
  version refusal is rebuilt; a silent worker is retired; the memory lane is always released.
- `autosave-version-check.test.ts`: a current snapshot is accepted without a parse; a newer or
  older one is refused whether or not its text leads with the version; a version nested inside the
  project does not count.
- `autosave-loop.test.ts`, `autosave-job-gate.test.ts`, `use-autosave-during-job.test.tsx`: the
  loop writes during a job only when its caller vouches; the three gate conditions; the waiting
  and failed signs, and what clears each.
- `BackgroundSaveStatus.test.tsx`, `use-machine-profile-persistence.test.tsx`: the signs.
- `e2e/autosave-during-job-responsiveness.e2e.ts` (opt-in) gave the numbers above, and the app's
  own loop writing a copy 7.5–11.2 s after an edit made during the job (five runs).
- Six existing autosave specs pass in Chrome with the commit in the worker.
- **Not verified:** a real controller, the USB worker route (ADR-354), the packaged desktop app, a
  production build, Firefox and Safari, and the worker's memory on the final build.
