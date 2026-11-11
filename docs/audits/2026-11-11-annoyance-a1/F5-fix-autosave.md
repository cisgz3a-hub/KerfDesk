# Annoyance audit A1 — fix group F5 (autosave)

- **When:** 2026-11-11. **Tree:** `origin/main` @ `95489484e`.
- **Findings:** A4-P2-1 (autosave is off for the whole length of a job) and A5-P2-1 (an autosave
  failure is said once, with no lasting sign).
- **Decision:** [ADR-305 Amendment 1](../../decisions/ADR-305-amendment-1-autosave-commits-in-its-worker-and-runs-during-a-job.md).
- **Evidence:** unit tests, and a Chrome measurement against a simulated GRBL job. No hardware was
  run.

## Reproduced

- **A4-P2-1: reproduced.** `autosave-loop.ts` returned early on `isStreaming`, and
  `use-autosave.ts` set that for `streaming` and `paused`. A unit test pinned it ("skips writes
  during streaming").
- **A5-P2-1: reproduced.** `createAutosaveFailureReporter` pushed one toast for each cause and
  kept no other state. The status bar had no element for it.
- **One premise of A4-P2-1 did not hold.** The audit read the guard's reason ("the interval must
  not perturb the render loop") as out of date since the autosave worker. The worker took
  serialisation off the window, but the commit still ran there, and it was not cheap (next
  section). Removing the guard alone would have stalled a streaming job.

## Method

`e2e/autosave-during-job-responsiveness.e2e.ts` (opt-in, `KERFDESK_AUTOSAVE_JOB_PERF=1`).

- A paced GRBL stand-in runs a real Frame and Start of an 85,787-line fill at 300 blocks a second
  on the window route, where the UI thread refills the controller.
- While it streams, the spec edits the project and waits for the app's own loop to write it.
- It then calls the autosave service with projects of several sizes. For each write it records:
  long tasks; the longest gap between the controller's acknowledgements; how long a real key
  press (F8, sent every 15 ms) waits for its handler; and the time the window spent handing the
  project to the worker.
- It ends with one real Ctrl+. pressed while autosaves run back to back, timed from the press to
  the soft reset on the wire.
- Chrome, Vite dev build, one PC shared with other test runs and short of memory.

## Before: what an interval autosave cost the window

Four writes of each project while the job streamed:

| Project | Recovery copy | Longest UI-thread task | Longest key wait |
|---|---|---|---|
| 2,000 objects | 2.1 M characters | none over 50 ms | 38 ms |
| 10,000 objects | 10.9 M | 146–153 ms | 146 ms |
| One trace, 1,000,000 points | 71.2 M | 219–626 ms | 618 ms |
| One 12 MP photo | 22.0 M | 58–892 ms | 870 ms |

A CPU profile of the window named the work:

- `requireSupportedAutosaveSnapshots` read both earlier snapshots back and ran `JSON.parse` on
  each, only to read a schema version: 71 ms at 2,000 objects, 221 ms at 10,000 and 624 ms for the
  trace.
- The worker's reply carried the whole project text to the window (5–28 ms), and
  `IDBObjectStore.add` copied it again (4–46 ms).
- Garbage collection of those copies: 104–219 ms on the large cases.

This cost was paid on every interval, job or not, from the second write of a session on: the
first write has no earlier snapshot to read back (51 ms at 10,000 objects here). Performance audit
S3 measured that first write on 2026-11-02 and found no long task.

## After: the final build

The worker that prepares the record also commits it, and the version check reads the version
from the head of the text. The window's share is the hand-off: packing the geometry and the
structured clone inside `postMessage`.

One run, four writes of each project, idle windows first. No write produced a long task. The
stream ran at 295–304 acknowledgements a second in every window, against 300 idle.

| Case | Weight | Let through during a job | Hand-off | Longest gap between acknowledgements | Longest key wait |
|---|---|---|---|---|---|
| Job only, no autosave (3 windows) | — | — | — | 19–22 ms | 2–9 ms |
| 200 objects | 1.0 M | yes | 0.6–0.7 ms | 12–21 ms | 2–5 ms |
| 2,000 objects | 9.6 M | yes | 4.3–7.3 ms | 11–23 ms | 2–4 ms |
| One trace, 400,000 points | 25.6 M | yes | 1.6–5.9 ms | 18–34 ms | 3–29 ms |
| One 12 MP photo | 22.0 M | yes | 6.3–16.9 ms | 19–22 ms | 3–14 ms |
| 10,000 objects | 48.0 M | no, waits | 21.3–33.0 ms | 23–35 ms | 5–17 ms |
| One trace, 1,000,000 points | 64.0 M | no, waits | 3.4–11.9 ms | 21–26 ms | 3–15 ms |
| Four 12 MP photos | 88.0 M | no, waits | 36.1–47.2 ms | 40–49 ms | 8–31 ms |

The last three rows are projects the job gate holds back. They were written anyway to show what
the gate avoids.

A second run wrote the two heaviest projects that are let through ten times each:

| Case | Hand-off | Longest gap between acknowledgements | Longest key wait | Long tasks |
|---|---|---|---|---|
| Job only (3 windows) | — | 20–23 ms | 1–3 ms | 0 |
| One trace, 400,000 points, 10 writes | 1.5–6.2 ms | 7–24 ms | 1–7 ms | 0 |
| One 12 MP photo, 10 writes | 5.6–16.5 ms | 7–25 ms | 1–10 ms | 0 |

**The app's own loop.** In five runs, an edit made while the job streamed had its copy in
IndexedDB 7.5–11.2 s later (the edit lands at a random point of the 30 s interval), and the status
bar showed no sign.

**Abort.** Ctrl+. from the press to the soft reset at the simulated controller, one press a run:

| Autosaves running back to back | Delay |
|---|---|
| None (2 runs) | 12 ms, 9 ms |
| One 12 MP photo (2 runs) | 9 ms, 7 ms |
| One trace, 400,000 points (1 run) | 10 ms |

## A stall found on the way, and what it changed

With the commit in the worker but the version check still parsing, the first repeat runs showed
gaps that were not the hand-off: 66–213 ms in 6 of 10 writes of the 1,000,000-point trace and
70–87 ms in 3 of 10 writes of the photo, with hand-offs of 4–25 ms and almost no long task.

A Chrome trace of the trace project explained them:

- Inside each gap the UI thread ran 5–8 tasks, 2–9 ms of work in all. It was idle, and its timers
  did not fire.
- So was every other Chrome process. The GPU process's vsync thread, which ticks every 17 ms and
  has no link to the page, ran no task for the whole of a 150 ms gap and of an 871 ms one.
- At that moment the autosave worker was in one 1.5 s task with a 578 MB heap (the two parses of
  71 MB of text), or the browser's IndexedDB thread was in a 0.8 s write of that text.

The whole machine had stalled, not the UI thread: this PC was short of memory, and several hundred
megabytes of short-lived copies pushed it over. That would stall a job on any route. Two changes
followed:

1. **The version check no longer parses a snapshot this build wrote.** The text starts with
   `{"schemaVersion":N`, so the check reads those characters. Text that starts any other way is
   parsed and judged as before. Writes became 2–4 times faster (the 1,000,000-point trace: 2.7–3.0
   s, from 4.2–11.8 s), and the stalls did not come back in 51 timed writes on the final build.
2. **The gate weighs the copy, not only the hand-off.** A vertex is cheap to hand over, but a
   million of them make 71 million characters of text for the worker to hold. A vertex therefore
   counts 64, so a 1,000,000-point trace waits for the job to end even though its hand-off is 4–12
   ms.

## What ships

1. **The commit runs in the autosave worker.** The window sends the project, then the expected
   epoch, and gets back "committed" or "conflict". The project text returns to the window only
   when the IndexedDB commit fails and the localStorage fallback needs it.
2. **The version check reads the head of the text.**
3. **Autosave runs during a job** when the job gate lets the project through:
   - its weight is at most 30,000,000 (one character of embedded text counts 1, a vertex 64, a
     scene object 4,000);
   - no hand-off measured during this job took more than 30 ms;
   - the last write reached IndexedDB.
4. **A project the gate holds back waits for the job to end**, as every project did before. The
   status bar shows **Autosave waiting for job** until the copy is written or the project is
   saved.
5. **A failed autosave stays visible.** The status bar shows **Autosave failed** from the failed
   write until the next good one, or until the project is saved. The toast is unchanged. Machine
   settings that cannot be saved show **Machine settings not saved** the same way.

## Not done, and limits

- The numbers are from Chrome on a Vite dev build, one PC, a simulated controller. A production
  build, the packaged desktop app, Firefox and a real controller were not measured.
- On the USB worker route (ADR-354) the UI thread does not refill the controller, so the hand-off
  can only delay Pause and Abort, by its own length. That route was not measured here.
- A project over the weight limit still has no recovery copy of work done during a job. It is now
  said in the status bar. Sending the hand-off in slices, and writing the copy in pieces, would
  lift the limit; neither is built.
- The memory an autosave needs in its worker was not measured on the final build. The limit keeps
  the copy near 30 million characters during a job; outside a job there is no limit, as before.
- `e2e/large-heightfield-autosave.e2e.ts` fails locally at "recovery card visible after reload",
  with the commit on the window as well as in the worker, so this change is not its cause. It was
  not investigated further. The other six autosave specs pass on the final build
  (`autosave-session-ownership`, `autosave-version-preservation` ×3,
  `recover-unsaved-work-unload-copy`, `browser-saves-by-download`).
- G-code output is unchanged: no file under `src/core` or `src/io` changed.
