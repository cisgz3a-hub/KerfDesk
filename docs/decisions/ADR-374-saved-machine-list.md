## ADR-374 - My machines: a workstation list of the operator's own complete machine profiles (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This adds an app-level list of machine profiles beside the per-project profile. It builds on the
`.lfmachine.json` machine-profile format, the atomic Machine Setup replacement (ADR-240/306) and
controller/profile compatibility (ADR-157). It keeps the Frame-first rule (PROJECT.md
non-negotiable 21, ADRs 228/230/232/237): a machine switch ends the completed Frame and adds no
Start guard.

### Context

- Every project carries its own complete `DeviceProfile`. Machine Setup offered a reviewed catalog,
  CNC setup profiles (`cncLibrary.machineProfiles`, which hold CNC job setup only) and a one-shot
  `.lfmachine.json` import or export. Nothing listed the operator's own machines.
- The maintainer runs three machines: a 4040 CNC router, a Creality Falcon laser and a Neotronics
  laser. Moving between them meant re-importing a file or re-entering bed size, origin, power
  range, dialect, scan offsets and camera calibration. Any value that was missed stayed from the
  previous machine.
- WORKFLOW F-A12 noted that no app-level registry existed to tell whether a project's embedded
  machine is one of this workstation's machines.
- LightBurn's Devices window (https://docs.lightburnsoftware.com/2.1/Reference/Devices/) keeps a
  global list with Create Manually, Import, Export, Duplicate, Remove and Set Default. Its Default
  is the device made active when LightBurn starts. Find My Laser probes ports only while a device
  is being added. The docs do not say what happens to open projects when the device changes, what
  Duplicate names the copy, or whether Remove asks first.

### Decision

1. **My machines is a workstation list, separate from projects.**
   - Entries live in this browser profile's storage (`laserforge.saved-machines.v1`, format
     `laserforge-saved-machines` version 1). They never enter a `.lf2` project and are never
     synced.
   - Each entry embeds a complete `.lfmachine.json` document, so the list reuses that format's
     validation and canonical form. The entry adds only its id, name, output mode (Laser or CNC),
     an optional recorded controller and timestamps.
   - Stored text that cannot be read, or that loses entries on reading, is first copied to
     `laserforge.saved-machines.v1.unreadable`, never cleared: a profile can hold hours of
     calibration.
   - A write from another KerfDesk window reloads the list, so one window cannot overwrite a
     machine saved in the other. A failed write shows a warning and keeps the change until
     KerfDesk closes.
2. **Actions.**
   - **Save current machine** adds the open project's profile and records the entry's id in the
     project (`DeviceProfile.savedMachineId`, one undoable label edit).
   - A linked project offers **Save changes to saved machine** and **Save as new machine**.
   - Each row offers **Switch to**, **Rename**, **Duplicate** ("(Duplicate)" suffix, as in
     LightBurn), **Set default** or **Clear default**, **Export…** and **Remove**.
   - Names are unique, ignoring case; the dialog names the entry that already has a name.
   - **Remove** asks inside the row, never in a blocking browser dialog. Projects that used the
     entry keep their own copy.
   - **Import…** adds a `.lfmachine.json` file as a new entry.
3. **Where operators see it.**
   - The machine rail's first line shows the open machine, whether it is one of My machines
     ("Saved in My machines", "Saved as “…”", "Not in My machines"), and a **My machines**
     button.
   - The job dock beside Frame and Start shows "Machine: <name>" with **Change**.
   - Machine Setup's Machine stage lists My machines before the catalog. Choosing one loads the
     complete profile, and its mode when the draft allows it, into the draft.
4. **Switch to applies every field.**
   - Switch uses the Machine Setup replacement: every `DeviceProfile` field is replaced in one
     undo entry, the workspace becomes the bed, and CNC parameters come from the saved
     `cncSubProfile`.
   - Every `DeviceProfile` field is classified in the difference table at compile time, so a new
     field cannot be forgotten.
   - Switch is refused while a job is active, Start is handing off, the machine is moving,
     auto-focus or a probe is running, or test fire is on.
   - When the live connection was opened for another driver or command set, the result asks for
     a reconnect.
5. **A switch always ends the completed Frame.**
   - Switch clears the Frame permit, trace and verification. The next Start says "The machine
     changed to “…” after Frame." This holds even when the new profile compiles the same program,
     because the Frame was traced against another machine's bed and output settings.
   - `savedMachineId` is descriptive in the execution signature, so saving the open machine to My
     machines keeps a completed Frame.
   - A Machine Setup Save that changes the linked entry counts as a switch and ends the Frame the
     same way.
6. **The project copy and the saved machine stay separate.**
   - `savedMachineId` is optional in `.lf2` and `.lfmachine.json`. A malformed value opens the
     project as unlinked.
   - A project whose entry exists and whose copy differs shows a non-blocking banner. The banner
     names the differing groups (Work area, Origin and homing, Controller and connection, …) and
     offers **Update saved machine**, **Use saved settings** and **Keep project copy**.
   - The comparison ignores names and evidence labels and uses the canonical profile form.
   - The banner waits while the opened-project machine banner asks its own question.
7. **Default machine.** KerfDesk starts, and **File > New** begins, with the default machine's
   complete profile and mode. Without a default, New keeps the open machine, as before.
8. **Recognition on connect.**
   - After a save with **Remember the connected controller** ticked, the entry records what the
     controller reported: banner firmware, stock GRBL `$I` version, build options and stored name,
     USB vendor and product ids, and the identity `$$` settings (`$3`, `$22`, `$23`, `$30`–`$32`,
     `$100`–`$102`, `$130`–`$132`).
   - Once a connection is qualified, a saved machine matches only when:
     - no reported firmware, version, build, name or USB id contradicts its record;
     - every recorded setting was reported with an equal numeric value;
     - at least three settings, the stored `$I` name or a non-generic USB id agree.
   - Common USB-serial bridges (CH340, CP210x, FTDI, Prolific) never identify a machine alone.
   - When exactly one saved machine matches and it is not the open one, the machine rail offers
     **Switch** or **Not now**. Two or more matches show nothing. KerfDesk never switches by
     itself.
9. **Files.**
   - Import marks imported scan offsets as verification pending, because a file is not bound to
     this physical machine and head. The workstation list restores its own entries exactly.
   - An imported file keeps its `savedMachineId` when no entry uses it, so projects made on
     another workstation still link. Otherwise the file becomes a separate entry with a new id and
     a numbered name.
   - A machine with both outputs takes the open project's mode when it supports that mode, as a
     Machine Setup catalog pick does.

### Consequences

- An operator saves each machine once, then moves between the router and the lasers with one
  undoable Switch that cannot keep the previous machine's bed, origin, power range or dialect.
- The machine a job will run on is named beside Frame and Start.
- This is not multi-machine control. One project still drives one connection, and PROJECT.md's
  out-of-scope "multi-machine, networked control" stands.
- Skipped for now:
  - importing a LightBurn `.lbdev` straight into the list (Machine Setup's import still loads one
    into a draft, and Save current machine adds it after Save);
  - per-machine icons (LightBurn's Set Icon) and a menu command or shortcut;
  - writing the recorded controller into exported files, because it describes this workstation's
    hardware;
  - a warning when a connected controller contradicts the open machine.

### Evidence and limits

- `saved-machine-list.test.ts`, `saved-machine-difference.test.ts` and
  `controller-fingerprint.test.ts` pin the list operations, the field classification, the matching
  rules and the single-match suggestion.
- `saved-machine-list-io.test.ts`, `saved-machines-persistence.test.ts` and
  `project-saved-machine-link.test.ts` pin the storage and file round trips, dropped entries, the
  backup key and the `.lf2` link.
- `switch-saved-machine.test.ts` switches to a profile with every field set and compares the whole
  device. `saved-machine-frame.test.ts` and `framed-run-device-metadata-retention.test.ts` pin the
  Frame rules. `saved-machine-startup.test.ts` pins the default machine.
- `MyMachinesDialog.test.tsx`, `SavedMachineProjectBanner.test.tsx`,
  `SavedMachineMatchNotice.test.tsx` and `DeviceSetupSavedMachines.test.tsx` drive the surfaces.
- No hardware was operated. Recognition was tested against recorded setting fixtures, not the
  maintainer's controllers. Whether their `$$` values stay stable across firmware updates is
  unverified. WORKFLOW F-H5 is the manual check.
