## ADR-490 Amendment 4 - An unsaved timelapse is kept until it is saved or cleared (2026-11-14)

**Status:** Accepted (the maintainer's choice on camera audit v2 K4-P2-3: "Keep until
saved/dismissed (Recommended)", relayed by the audit coordinator). Amends the Consequences that a
new job "starts a new timelapse" and that a recording is "live until the next watched job or
**Clear**". | **Date:** 2026-11-14

### Context

A new run emptied the last recording at once, with no prompt. That included Continue after a lost
connection (which rebuilds the plan as a new run), Second pass, and the next watched job. A
recording the operator had not saved was gone, and a run started within seconds of the end also
lost the final frame.

### Decision

1. **A recording with frames that was neither saved (Save video) nor cleared is never emptied by a
   new run.** It is kept, marked finished, and that run is not recorded. Its note, and one toast,
   say so: save it or clear it, and the next job records again.
2. **Job Review asks first.** While a timelapse is wanted and the last one is unsaved, Job Review
   says this job will not be recorded, and how to record it (cancel, save or clear, start again).
3. **A saved recording** may be replaced by the next job, as before.
4. With watching off, an unsaved recording is kept too.

### Consequences

- No recording is lost to Continue, Second pass or the next job.
- A job started with an unsaved recording is not recorded, which Job Review says before Start.
- Code and synthetic evidence only.

### Verification

`src/ui/camera/job-watch/job-watch-runner.test.ts`:
- an unsaved recording is kept, finished and noted when the next watched job starts, and Job
  Review's fact is set;
- a saved one is replaced by the next job;
- an unsaved one is kept when a job starts with watching off.
