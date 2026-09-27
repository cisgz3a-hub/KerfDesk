## ADR-493 - Machine-moving tools from the LightBurn gap list, batch 6 (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

Builds LBG-T15, LBG-M02 and LBG-M07 from `docs/audits/2026-09-26-lightburn-gap-audit.md`. The
maintainer chose "Build all ten" on 2026-09-27, as two pull requests: the seven design tools first
(ADR-480), then these three, which move the machine. None of them has been tried on a real machine.

### Context

LightBurn behaviour, read on 2026-09-27 from `https://docs.lightburnsoftware.com/latest/Reference/`:

- **Move Laser to Selection** (`MoveLaserToSelection/`): moves the head to the centre, a corner or an
  edge midpoint of the selection, nine points in all. It relies on the machine being homed, because
  the canvas point has to mean a place on the bed.
- **Move window** (`MoveWindow/`): **Move to position** takes X and Y and moves there in absolute
  machine coordinates. **Saved Positions** are added under a name with Manage, Add New, and gone to
  with Go. The keyboard jogs with `Alt/Option+Ctrl/Cmd+[` (left), `Alt+Ctrl+]` (right),
  `Shift+Ctrl+]` (up) and `Shift+Ctrl+[` (down), and with the numeric keypad arrows while Num Lock
  is on. Each press moves the window's Distance at its Speed.
- **Finish Position** (`MoveWindow/`, `DeviceSettings/`): where the head goes when a job ends.
  Default 0,0; **Set Finish Position** in the Move window stores the current head position; Device
  Settings can change or disable it.

KerfDesk already had the parts these need: click-to-move (`position-laser-click.ts`), Go to work
zero, the store's beam-off `jogToMachinePosition` (work-offset delta, CNC safe Z, Frame permit,
configured-bounds and no-go-zone warnings), the verified native bed frame (ADR-342), the job-end
park (`job-park-target.ts`) and the CNC park's bed-to-program translation (ADR-392). Bare arrow
keys nudge the selection and never jog (F104); PageUp and PageDown jog Z (ADR-362).

### Decision

1. **Two coordinate frames for a head position** (`core/devices/head-position-frames.ts`).
   **Canvas** is the scene millimetres the rulers and the X/Y boxes show. It maps through the same
   origin transform G-code emission uses and then the verified native bed frame, so it is where an
   Absolute Coordinates job burns that point. Without a verified frame it goes where an Absolute job
   would go (native targets equal machine coordinates, as start-job preparation does) and warns
   that the physical spot must be checked, the same warning Start gives; it is not refused.
   **From origin** is work coordinates, the numbers in the job's G-code: MPos = work position +
   work offset, so it needs no homing. LightBurn's absolute machine numbers are not offered as a
   third frame: KerfDesk shows MPos only in the status readout, and the two frames above are the
   numbers an operator reads on screen.
2. **One dispatcher** (`ui/laser/head-move-dispatch.ts`). Every typed, saved and selection move
   resolves to native MPos and goes out through `jogToMachinePosition` at the jog pad's speed,
   clamped to the active head's maximum feed. Not connected, not Idle, or a From origin move before
   the controller has reported a work offset is a notice and nothing is sent. Those are transport
   facts, not new guards (ADR-228). The existing jog policy warns about configured bounds and no-go
   zones and still sends the jog (ADR-232); nothing is clamped. With the rotary on, a move goes to
   X only and keeps the current Y, with a notice: rotary output rebases Y to the job's own start
   and scales it to the roller, so no canvas or work Y names a rotation. Click-to-move keeps its
   own refusal of an unverified mapping; it answers "the spot under the camera", which needs the
   physical bed.
3. **Move laser to selection** (LBG-T15). `Arrange → Move laser to selection` has the nine points
   of the selection's world bounds, like Move to bed. It needs a selection and runs in Absolute
   Coordinates. In User Origin, Verified Origin and Current Position the job is placed from the
   origin when it is prepared, from the prepared job's bounds (`jobOriginOffset`), so a canvas point
   has no fixed spot until then; the command explains that and points at Frame instead of
   guessing. It is offered in CNC too: the store's point move lifts to safe Z first.
4. **Move to position and saved positions** (LBG-M02). A collapsed **Move to position** section
   under the jog pad has a Coordinates choice (Canvas, From origin; it starts on Canvas in Absolute
   Coordinates and on From origin otherwise), X and Y, **Go** and **Use current**. Untouched X and Y
   start on machine X0 Y0 (in canvas numbers) or work zero, never on canvas 0, 0, which is the back
   of a front-origin bed. **Save** stores
   the typed position with its frame under a name in `DeviceProfile.savedPositions`; a blank name
   gets the next "Position N", and saving under an existing name replaces that entry. Each saved
   row has Go and Delete. Saving and deleting are one undo step each and mark the project changed,
   and the list travels with the machine profile and the project file. The fields are optional, so
   the project schema does not change.
5. **Laser finish position** (LBG-M02). Machine Setup's laser step has **After a job**: Go to the
   work origin (the default; nothing is stored, and a Current Position job still returns to its
   start), Stay where the job ends (no park move in any mode), or Go to a bed position in canvas
   coordinates, like the saved Canvas positions; choosing it starts on machine X0 Y0, LightBurn's
   default finish, shown in canvas numbers. Stay and a bed position replace a Current Position
   job's return to its start, so the next Start begins where the head was left; the Machine Setup
   hint says so. **Finish jobs here** in Move to position sets the
   bed position from typed Canvas numbers, which is LightBurn's Set Finish Position. Preparation
   places the finish once on the laser job (`placeLaserFinish`, `Job.laserFinish`): canvas →
   `toMachineCoords` → the same bed-to-program translation that places the CNC park (ADR-392).
   Where that translation is unknown, or the rotary is on (rotary Y is rotation from the job's own
   start), the finish is set aside: the default applies and a Job Review warning says why; it is
   not a guard. `finishOptionsForJob` is the only reader, used by emission, CNC pass-span
   re-emission, the preview, both estimates and Job Review's park target, so none of them can
   disagree about the last move. With no finish set the output is byte-identical, so the emitter
   revision stays. Saved head positions never reach the program, so they are left out of the Frame
   permit's execution signature; a changed finish position is not, and needs a fresh Frame.
6. **Keyboard XY jog** (LBG-M07). LightBurn's four chords, matched on the physical key
   (`BracketLeft`, `BracketRight`) so keyboard layouts and Shift's `{`/`}` do not matter, and the
   keypad digits 8, 2, 4, 6 and the diagonals 7, 9, 1, 3 while Num Lock is on. Each press sends
   exactly what the matching jog pad arrow sends: the same physical direction for the device
   origin, step, clamped speed, jog action and failure notice. They work only while the jog pad is
   shown and enabled, send one step per press (no auto-repeat), and do nothing in a dialog, a text
   field or a focused scrolling list. Bare arrows still nudge the selection (F104); with Num Lock
   off the keypad sends arrow keys, so one key never both nudges and jogs.

### Alternatives considered

- **Place Move laser to selection in User Origin by rebuilding the job placement in the UI.** The
  job's anchor comes from the prepared job's bounds (`computeJobBounds` on the compiled job), not
  the canvas bounds. A copy of that rule in the UI could drift from the real output and move the
  head to a place the job does not burn. Frame already traces the prepared job. Left as a
  follow-up that would read the prepared job's placement offset.
- **Clamp typed and selection moves to the bed**, as click-to-move does. Rejected: ADR-232 makes
  configured bounds guidance and the controller's limits the authority, and a silently moved
  target is worse than a warned one.
- **Auto-repeat while a key is held.** LightBurn moves one Distance per press. A held key that keeps
  queueing jogs is harder to stop than the pad's hold-to-jog, which cancels on release.

### Consequences

- Machine profiles and project files may carry `savedPositions` and `laserFinishPosition`. Both
  are optional and validated the same way on project load and machine-profile import, so the
  project schema stays the same. Older builds keep both fields on re-save (the device normalizer
  spreads unknown fields) and park at their own default; an older machine-profile import drops
  them.
- On the macOS web build, `Cmd+Shift+[` and `]` are the browser's tab-switch keys and may never
  reach the page; the desktop app and the keypad keys are unaffected. Not tried in a browser.

### Verification

- Unit: `head-position-frames.test.ts` (both frames, exact inverse including the centre origin,
  unverified mapping), `move-laser-to-selection.test.ts` (native targets for the nine points,
  unverified warning, other Start From modes, no selection, disconnected, missing work offset,
  failure notice), `MoveToPositionSection.test.tsx` (typed Go, Use current, save, go, delete,
  disabled), `use-jog-shortcuts.test.ts` and `JogPad.keyboard-jog.test.tsx` (every key against its
  arrow on front-left and rear-right machines, and every key that must do nothing).
  `laser-finish.test.ts`, `laser-finish-position.workflow.test.ts` (the real placement, prepare and
  emit path in Absolute with zero and known work offset, User Origin known and unknown, Current
  Position placed and not, and `stay` in all five modes: the last G-code move, the park target,
  the park-outside-frame note, the preview's final travel and both estimates agree; with no finish
  set the output is byte-identical to before), `laser-finish-set-aside-warnings.test.ts`,
  `project-head-positions.test.ts`, `machine-profile-head-positions.test.ts`,
  `DeviceSetupLaserFinishRows.test.tsx`, `laser-finish-mode-switch.test.ts` (Laser → CNC → Laser
  keeps both fields) and `canvas-motion-plan-output-scope.test.ts` (saving a position keeps Frame;
  a finish change does not).
- Not verified on hardware. An air run should check: Move laser to selection on a homed machine
  lands on the artwork corner under the camera or a pointer; a saved From origin position returns
  to the same spot after Set origin here; the keypad and chords jog the pad's step; a job with a
  bed finish position parks there with the beam off.
