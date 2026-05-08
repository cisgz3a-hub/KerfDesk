# Production Runs

Production runs: prefer Set Origin + Use saved zero point for repeatable jobs.

Use this workflow when the workpiece matters, when you plan to run the same file more than once, or when the job is long enough that a small placement error would waste material:

1. Jog the laser to the workpiece reference corner.
2. Click Set Origin.
3. Choose Use saved zero point in Job Position.
4. Frame the job.
5. Start the job.

Start from laser head is still useful for quick one-off jobs, alignment tests, and prototype iterations. It is faster, but it depends on the current head position being exactly where the job should begin.

For repeat burns, fixtures, customer work, and longer jobs, Use saved zero point is easier to verify because the job is anchored to a deliberate physical zero point instead of the transient head position.
