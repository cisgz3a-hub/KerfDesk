## ADR-180 Amendment 8 - Start names FluidNC's Resume spin-up for a router job (2026-11-09)

**Status:** Accepted (rolling audit v11 W2-P2-1, refuter's "gap noted" under "Remote Start keeps
the desktop guards"). | **Date:** 2026-11-09

### Context

Amendment 7 made the FluidNC Resume advice say that KerfDesk never lifts the bit on FluidNC, and
that Resume waits only the spindle's YAML `spinup_ms`, which is 0 unless set. That advice appears
only once a job is paused, in the paused job panel and on the Resume button. The Start review
warns about `$32=1` and an unconfirmed `$32` ("Resume after a pause restarts motion with no
spin-up"). For a FluidNC router at `$32=0`, though, nothing at Start named `spinup_ms`. A job
started and paused from a phone never showed the PC panel. ADR-585 Amendment 2 now carries that
panel's text to the phone, and this amendment states the fact before the job runs.

### Decision

1. **A CNC Start on FluidNC adds a warning, `fluidnc-resume-spinup`.** FluidNC means the banner's
   firmware, or the read-only settings dump. The warning goes to Job Review, and from there to the
   phone review. It says that if the job is paused, KerfDesk does not lift the bit and Resume
   waits only `spinup_ms` (0 unless set), so the bit is fed through the cut while it speeds up. It
   then says to set `spinup_ms` to the spindle's time to full speed, or after a pause to use ABORT
   JOB and recover instead of Resume.
2. **Not with `$32=1`.** There the laser-mode error, which Job Review already shows, says that
   Resume has no spin-up and that the router's spindle must be configured.
3. **Not on Save/export.** The export advisories leave this code out, because KerfDesk never
   pauses a saved file.
4. **Warning only.** Like every controller-setting judgement, it never refuses Start (rule 7,
   ADR-228).

### Consequences

- A FluidNC router operator reads the spin-up fact in the Start review on every route: the PC, the
  phone review and the external-run readiness.
- GRBL, grblHAL and laser jobs are unchanged.
- Based on the FluidNC source and wiki cited in Amendment 7. Not hardware-tested.
