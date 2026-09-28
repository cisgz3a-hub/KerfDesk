## ADR-502 - Machine hours and maintenance reminders (2026-09-28)

**Status:** Accepted. | **Date:** 2026-09-28

A due reminder is advisory (ADR-228), and jobs start as before.

### Context

KerfDesk kept no record of how long a machine had run, so lens cleaning, belt checks and collet
care were left to memory. Adding each job's estimated duration would count cancelled work in
full; the counter therefore follows the observed running lifecycle.

### Decision

1. **Measured time.** A started job's live run (the one the canvas follows) drives a clock:
   - It counts while the job runs. Pauses and tool changes stop it.
   - The job ends at its first stop, disconnect, error or finish.
   - A stopped job counts the time it ran, because the machine ran it.
   - Only Start makes a live run, so frames, jogs, console moves and Preview never count.
   - A timer checkpoints running time every minute even without controller events. Browser
     timer suspension or unavailable storage can delay persistence.
2. **Per machine.** Hours belong to the machine the job started on, keyed like Machine Setup's
   marks (`deviceProfileSignature`: profile, bed and controller, with CNC apart from laser). They
   live in browser storage (`kerfdesk.machine-hours.v1`), not in projects. Each change re-reads
   available storage; this reduces stale writes but is not a transaction across windows.
   Failed writes retain pending changes in memory and retry them once storage becomes available.
   Reads drop entries that do not validate. Mounting with an already terminal canvas run does
   not count that completed job again.
3. **Reminders.**
   - Each machine starts with three. A laser gets the lens (20 h), the air-assist nozzle and fans
     (50 h), and belts, wheels and rails (100 h). A CNC gets the collet and bit (20 h), rails and
     lead screws (50 h), and the spindle mount and belts (100 h).
   - These are round starting figures, not manufacturer intervals. Intervals can be changed
     (0.5 to 10,000 h), and reminders added and removed.
   - **Done** counts the interval again from the machine's current hours.
4. **Where.** A **Machine hours** section in the machine rail shows the hours, jobs and reminders.
   Its heading counts those due. When a job's time makes a reminder due, a warning toast names the
   machine and the task, once.

### Alternatives

- **Count estimated durations.** Rejected: an estimate is not what the machine did, and a
  cancelled job or a frame would count in full.
- **Count laser-on time only.** Not now: the controller does not report when the beam is on, so it
  would be an estimate again. Run time is measured; for a diode, laser-on time is below it.
- **Keep hours in the project.** Rejected: hours belong to the machine, across projects.

### Consequences

- Hours start at zero for every machine on update; earlier jobs are not counted.
- A machine left on the generic starter profile shares one record with any other machine left on
  it, as its Machine Setup mark does.
- Hours kept in one browser or desktop install are not shared with another.

### Verification

- `machine-hours-tracker.test.ts`:
  - Running time counts; pauses and tool changes do not.
  - A stopped job counts the time it ran.
  - Time is handed over every minute.
  - A replaced or cleared run ends its job, and no job counts nothing.
- `machine-hours.test.ts`:
  - Hours and jobs are kept per machine, laser apart from CNC, each with its own reminders.
  - A reminder falls due after its interval and is announced once.
  - The storage round trip drops what does not validate.
- `MachineHoursSection.test.tsx`:
  - The panel shows the hours and what is due, and Done restarts a reminder.
  - Edits, additions and removals are kept.
  - A running job is counted without its pause, to the machine it started on, and the due reminder
    is announced.
- Not tried on a machine.
