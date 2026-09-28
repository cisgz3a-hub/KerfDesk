## ADR-500 - A banner while the job is on the starter machine (2026-09-28)

**Status:** Accepted. | **Date:** 2026-09-28

The banner is advisory (ADR-228): it blocks nothing and nothing waits on it.

### Context

Every session starts on the generic 400 × 400 mm starter machine (WORKFLOW.md F-A1). The only sign
of it was the status bar's "Device: Default 400×400". Machine Setup's nudge ("This machine isn't set
up yet") shows only while a controller is connected. So someone who designs before connecting, or
never connects, works to a bed, power range and speeds that are guesses, and nothing says so.

That also held for someone who had already set up their machine: nothing restores a machine between
sessions, so each new session was back on the starter machine until a project or its autosave was
opened.

F-A1 rules out a welcome modal or tour on launch. A passive banner can explain the starter
profile and offer the last saved machine without interrupting the workspace.

### Decision

1. **A card over the canvas's top right corner** while the project's machine is the starter
   machine exactly as it ships. It is a status note with buttons, not a dialog, does not take
   focus, and takes no room from the canvas: a line above the workspace cost a compact window a
   quarter of its canvas height.
   It gives the corner up while the G-code view's bar or the registration jig panel, which sit
   there too, is showing, so it never covers their buttons, and comes back when they go.
2. **What it offers.**
   - First time: "Generic 400 × 400 mm machine. The bed, power and speeds are guesses until you set
     up your machine. You can design now and set it up later." **Set up machine** opens Machine
     Setup.
   - After a machine was saved in Machine Setup: "Your last machine was *name* (*bed*)." **Use
     *name*** applies that machine as one undo step, as a machine profile import does. **Set up
     another** opens Machine Setup.
   - **Not now** hides it until KerfDesk next starts.
3. **The last machine.** Machine Setup's Save keeps the saved machine profile in browser storage
   (`kerfdesk.last-machine.v1`), in the machine profile export format, so it is validated when read
   back. A missing or invalid entry means the banner offers Machine Setup instead.
4. **When it goes.** Any change to the project's machine hides it: Machine Setup, a machine profile
   import, an opened or restored project, Use *name*, or an edit to the profile. Undoing back to the
   starter machine shows it again. It stays hidden for anyone who set up the starter machine itself,
   as a laser or a CNC.
5. **Launch is unchanged.** The session still starts on the starter machine, with no modal and no
   tour, and nothing is applied until the operator clicks.

### Alternatives

- **Open the last machine by itself at launch.** Rejected: F-A1 starts every session on the
  starter machine, and switching machines silently changes the bed, the output and the layer
  defaults. One click keeps the operator's say.
- **Status bar text only.** Rejected: it was already there as "Default 400×400" and read as a name,
  not a warning.
- **Remember every machine, with a picker.** Not now: saved CNC machine profiles already exist for
  CNC (ADR-112), and one last machine covers the common one-machine shop.

### Consequences

- A new operator sees at once that the machine is not theirs yet, and where to set it up.
- A returning operator gets their machine back in one click. The CNC side's stock, bits and Tool
  Plan are not part of the machine profile; they come from saved CNC machine profiles as before.
- The card covers the canvas's top right corner (340 px wide at most) while it shows; the canvas
  keeps its size, and the far corner of the bed stays reachable by panning or Not now.

### Verification

- `machine-setup-banner-state.test.ts`:
  - Shows on the starter machine, hides on any other or an edited one.
  - Hides when the starter machine was set up, as a laser or a CNC.
  - Offers the last machine, and hides after Not now.
- `last-machine-persistence.test.ts`: the saved machine comes back the same, an invalid entry is
  ignored, and a storage error is not.
- `MachineSetupBanner.test.tsx`:
  - Set up machine opens Machine Setup.
  - Use *name* applies the last machine as one undo step, and undo brings the banner back.
  - A project's own machine and Not now hide it.
- `MachineSetupDialogHost.test.tsx`: Save keeps the saved machine for the next session.
