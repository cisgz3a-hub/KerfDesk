## ADR-392 Amendment 1 - No park is its own setting, and an unset park says where the job ends (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

### Context

ADR-392 made a configured park a bed position that moves with the job, and left two things as they
were. First, Machine Setup showed an unset Park X and Y as 0 with no way to clear them (CNC audit
MC-7). Typing a value and then 0 left a park at X0 Y0 instead of none. Since ADR-392, 0, 0 is a
real place on the bed, so a touched field silently turned "return to the job start" into "rapid to
the bed corner", at the end of the job and at every bit change. Second, Job Review labelled an
unset park "Machine origin". A placed job never ends there: without a park, a Current Position job
returns to its start and every other job ends at program X0 Y0 (`parkTarget`). The CNC setup
reference and the Machine Setup review page printed an unset park as "X 0, Y 0" and "0, 0 mm".

### Decision

1. **Park at a bed position** is a toggle in Machine Setup's CNC machine limits. Park X and Y show
   only while it is on. Turning it on starts the park at bed 0, 0. Turning it off removes both
   fields, which is the unset state the compiler and emitter already understand. Nothing else in
   the machine parameters changes.
2. Job Review's "Park after job" reads `Bed X … · Y …` for a set park, with either field making one
   and the other reading 0, as the compiler does. For none, it names where the reviewed job ends:
   "Not set · back to where the job started" for Current Position, and "Not set · program X0 Y0"
   for every other placement. The review model now carries the prepared job's placement
   (`startFrom`) for this. A caller without one gets "Not set · program X0 Y0, or a Current
   Position job start".
3. The CNC setup reference and the Machine Setup review page show an unset park as "None", and a
   set one as a bed position.

Emitted G-code does not change: an unset park already fell back as described, and a set park is
placed exactly as ADR-392 decides.

### Consequences

- An operator can return a park to none, and the labels no longer claim a park where there is
  none. The CNC audit's MC-7 is closed.
- Saved profiles and projects are unchanged. An unset park was already stored as absent fields, and
  a park an operator once typed stays set until they turn it off.

### Evidence

- `src/ui/laser/device-setup/DeviceSetupCncMachineStep.park.test.tsx`: no park fields while unset;
  turning the park on dispatches 0, 0; turning it off removes both fields; a set park shows its
  numbers.
- `src/ui/laser/job-review/job-review-live-rows.test.ts`: set parks read as bed positions, and
  unset parks read by placement. With the old "Machine origin" label restored, the test fails.
