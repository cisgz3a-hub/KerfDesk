## ADR-237 Amendment 3 - Run again of an unchanged, already-reviewed laser job does not show Job Review again (2026-11-11)

**Status:** Accepted. Maintainer decision, 2026-11-11, on finding A2-D-1 of the user annoyance
audit A1. | **Date:** 2026-11-11

ADR-237 carries two unnumbered amendments in `DECISIONS.md` (descriptive evidence retention,
2026-09-06; extended position reports, 2026-09-19). This is the third.

This amends, for the one case below:

- ADR-237: "Pressing **Start** on a review-pending permit opens the one Job Review."
- [ADR-372 Amendment 1](ADR-372-amendment-1-run-again-needs-a-fresh-frame.md), decision 1: "Run
  again follows Start exactly", including "the permit's single Job Review".
- [ADR-565](ADR-565-frame-remains-valid-for-unchanged-placement.md): "Each Start prepares and
  reviews the current exact executable program."

ADR-224 is unchanged: Job Review is still the only review and warning surface, and nothing here
adds a refusal or a gate. Evidence is tests and the controller simulator; no hardware
qualification is claimed.

### Context

Every Start opens Job Review, and **Run same job again from start** follows Start. A user burning
ten identical coasters confirmed ten identical reviews. The program had not changed, the warnings
had not changed, and the dialog asked nothing: on a laser whose `$30`/`$32` are verified it
shows a "Laser mode verified" note and one **Start job** button. The audit also noted that focus
lands at the top of the dialog, so each repeat was a click on Run again and then a mouse move to
Start job.

ADR-237 already has a case where review evidence travels without a dialog: a transient camera
Frame is reviewed before it runs and streams "without reopening the dialog".

### Decision

1. **The rule.** When the operator presses Run again and all of the following hold, the job starts
   without showing Job Review. In every other case Job Review opens as it does for Start.
   1. It is the desktop Run again button, and the machine is a laser. A CNC job always shows the
      dialog: the CNC setup attestation is an affirmation about this run's workholding and bit,
      so it is clicked for each run.
   2. The freshly prepared program is the one the completed run sent: the same execution
      signature and the same G-code fingerprint as the receipt. Run again still needs a valid
      completed Frame and still never runs one.
   3. The review the dialog would show needs no answer: its acknowledgement is `laser-verified`,
      it has no converted-laser question (ADR-637 Amendment 8), and nothing would disable its
      Start button.
   4. Its warnings are the same set the operator accepted for the run being repeated. One more
      warning, one fewer, or one worded differently shows the dialog.
   5. That earlier review happened in this app session, on this controller session.
2. **Where the accepted review is read from.** A small in-memory record,
   `session-reviewed-runs.ts`, written when a reviewed laser Start is handed to the controller:
   the run id, the controller session number, the review's warnings, and which run's dialog the
   operator confirmed and when. Run again looks up the receipt's run id there. The completed run's
   own archive must agree with it (an ordinary Start, the same controller session number, the same
   warnings); if it does not, the dialog shows. The archive alone is not enough: a controller
   session number starts again from zero in a reloaded page, so an archived number can equal the
   live one by accident. Memory does not survive a reload, a second window or another KerfDesk, so
   in all of those the dialog shows.
3. **The decision runs through the review gate.** `runJobReviewGate` already takes a presenter
   (ADR-638). Run again passes one that either opens the dialog or, when the rule holds for the
   model the gate built, stands in for it and confirms once. The gate then does what it does after
   any confirm: it prepares again against the live stores, refuses a changed artifact, a failed
   preparation, a Frame mismatch and an open machine-type question, and builds the evidence. If the
   gate does not accept the stand-in's confirm, the stand-in closes without side effects (it does
   not revoke the Frame) and the real dialog opens.
4. **The evidence is this run's own, and says it was carried.** `reviewedAtIso`, the review model
   with its warnings, and `laserModeStartEvidence` are built from the fresh preparation by the same
   code as a clicked review; `unverifiedAcknowledged` is false, because nothing was acknowledged.
   The archived review also holds `carriedOver`: `fromRunId` (the run repeated),
   `operatorReviewedRunId` (the run whose dialog was confirmed) and `operatorReviewedAtIso`. With
   `carriedOver` present, `reviewedAtIso` is when KerfDesk compared the reviews, not a click. The
   provenance validator accepts `carriedOver` only on a `laser-verified` ordinary Start whose
   `completedReplaySourceRunId` is that `fromRunId`. A repeat of a repeat carries the same
   original click and keeps naming it.
5. **Nothing after the review changes.** The permit is rebound and claimed, the Start boundary
   compares the controller, origin and position, the durable Start intent is armed, and the final
   wire handoff asserts again, exactly as for a clicked review.
6. **Other Starts.** Ordinary Start always shows Job Review. A caller with its own presenter, which
   is the phone and MCP remote approval sheet (ADR-638), keeps its presenter, and it never passes a
   receipt, so the rule cannot apply to it. A run approved through that sheet is not remembered, so
   a later desktop Run again of it shows the dialog. Camera-marker and painted second-pass permits
   are unchanged.
7. **The operator is told.** Once the controller has the job, a notice says "Running the same
   reviewed job again." With warnings it says how many were carried and lists them when opened.
   The Run again tooltip says the job can start without Job Review. Because one press can now
   start the laser, the button uses the fresh-key guard that Frame job uses (ADR-207 Amendment
   3): an auto-repeated Enter does not press it.

### Alternatives rejected

- **A one-line confirm with a "Show review" link.** It is still a second click per coaster, which
  is the cost the maintainer chose to remove.
- **Comparing the whole review model.** The estimate tiles move with timing calibration after each
  run, so the dialog would have come back for no reason the operator could act on. The warnings,
  the acknowledgement and the exact program are what a review approves.
- **Reading the accepted warnings from the archive only.** It would carry a review across a reload,
  where "this controller session" cannot be established.

### Consequences

- Repeating an unchanged job is one press. A changed setting, a new or missing warning, a
  reconnect, a reload or a lost laser-mode reading brings the dialog back.
- The operator does not see an unchanged warning again on a repeat. The notice counts the carried
  warnings; the first run of every job in a session is still reviewed in full.
- An archive written by this build can hold a field older builds do not know. They ignore it; the
  envelope hash covers it either way.
- `PROJECT.md` non-negotiable 21 and WORKFLOW "Repeat — Run again" state the exception.

### Evidence

- `run-again-review-carry.test.ts` runs the real Start flow, review gate and recovery repository
  with a stubbed controller. Run again starts with no dialog, sends the completed run's bytes, and
  archives `carriedOver`; a third run names the first. The dialog shows after a reload, for an
  unverified laser, for an added and for a removed warning, for a changed program, on a new
  controller session and with a caller's own presenter. Ordinary Start always shows it.
- `run-again-review-carry.conditions.test.ts` covers the CNC cases, an archive that disagrees with
  the session record, a stand-in whose confirm the gate refuses, and the validator.
- `repeat-handover.simulator.test.tsx` runs three identities over the GRBL simulator: the first
  reviewed, the next two carried, and a Frame revoked during the handoff still refuses the wire.
- `RunAgainControl.test.tsx`: an auto-repeated Enter is cancelled before it can press the button.
- `e2e/frame-once-process-edits.spec.ts`: on the simulated controller Run again starts with no
  dialog, and the next, changed run opens Job Review.
