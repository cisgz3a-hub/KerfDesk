# User annoyance audit A1 — ledger

**Requested by** the maintainer on 2026-11-11: "lets audit for all annoying stuff that can annoy a user like pop ups, blocks, ui blocks, controller blocks etc".

**Tree.** `origin/main` @ `a1518de75`. Evidence and method: [REPORT.md](REPORT.md).

**Limits.** Static read only: nothing was run. Every P2 was re-read in `main`'s code by the coordinator. There was no refuter pass, so ratings are provisional until a fix session reproduces each finding. Three findings are marked "runtime check owed".

## Verdict

Nothing found stops a user outright. The way from Frame to Start is clean: one gate, one review, one click, and every greyed-out Start or Frame says why.

The annoyance is around that path, and it has four causes:

1. **Native popup boxes.** 109 call sites still use the browser's OK/Cancel boxes. They cannot name their buttons, cannot be remembered as dismissed, and must be refused while a job runs.
2. **Toasts.** About 586 call sites, about 10 of which reuse a slot. A toast's lifetime depends only on its colour, three show at once, and there is no history.
3. **Nothing can be turned off.** No setting, and no "don't ask again", exists anywhere.
4. **Blocks that outlast their cause.** After an Unlock, a console line, a jog step or a panel click, something stays greyed out or silent longer than it needs to.

## Severity

| Level | Meaning in this audit |
|---|---|
| P1 | Stops a user's work, or loses it. |
| P2 | Interrupts or blocks often. A workaround exists. |
| P3 | Polish: wording, a rare interruption, or an inconsistency. |
| D | Deliberate (an ADR or the maintainer's own instruction). Listed for a decision, not as a defect. |

## Totals

| # | Area | Raised | P1 | P2 | P3 | D |
|---|---|---|---|---|---|---|
| A1 | Native popups and modal dialogs | 14 | 0 | 4 | 10 | 0 |
| A2 | Start, Frame and Job Review | 2 | 0 | 0 | 0 | 2 |
| A3 | Controller blocks | 11 | 0 | 4 | 6 | 1 |
| A4 | Workspace and file-flow blocks | 12 | 0 | 7 | 5 | 0 |
| A5 | Nags and notice noise | 15 | 0 | 7 | 7 | 1 |
| **Total** | | **54** | **0** | **22** | **28** | **4** |

## P2 findings (coordinator-read)

| ID | Summary | How often | Deliberate? | Fix status |
|---|---|---|---|---|
| A1-P2-1 | **"Save" image preset does nothing in the desktop app**: it uses a native prompt box, which Electron does not show. Runtime check owed | Every attempt on desktop | No | open |
| A1-P2-2 | **A "Job complete" modal opens after every laser job** to offer a second pass, with no "don't offer again" | Every laser job | ADR-341 Amd 3, 4 | kept as it is (maintainer, 2026-11-11) |
| A1-P2-3 | **Recovery, resume and Run G-code file stack two to four native confirms** after their own in-app review | Rare; every CNC Run-file | Content yes (ADR-237, 630); form no | open |
| A1-P2-4 | **While a job runs, confirms are refused with "A job is running — stop it before discarding or replacing work."**, even for deleting a preset or naming one | Every long job | Fail-closed yes (non-negotiable 9); native form no | open |
| A3-P2-1 | **After any Unlock the head position is hidden**, and Move to position says "Wait for a status report", which can never help | After every alarm cleared with Unlock | ADR-367 in part | PR #1735 (ADR-367 Amd 3): hidden only for alarms that lose position; dead ends reworded |
| A3-P2-2 | **Quick jog taps are dropped**: the queued step jog of ADR-674 can never be reached from the jog pad (two conditions exclude each other). Runtime check owed | Every session | No (bug) | open |
| A3-P2-3 | **A lid opened at Idle leaves a controller reset as the only way out on screen**; the reset can clear the origin | Every material load on such machines | ADR-375 item 10 | open |
| A3-P2-4 | **Console: Enter does nothing while blocked, and each line blocks the next for up to a second** with a message about jogging | Every quick pair of console lines | No | open |
| A4-P2-1 | **Autosave is off for the whole length of a job**, so work drawn meanwhile has no recovery copy. Contradicts WORKFLOW F-C3 | Every job | No | open |
| A4-P2-2 | **After touching a checkbox, slider or dropdown, Delete, Ctrl+Z, copy/paste and arrows do nothing** until the canvas is clicked | Every session | For text fields only | open |
| A4-P2-3 | **Locked artwork can only be freed with "Unlock All"** | Every session for users who lock | No | open |
| A4-P2-4 | **Save G-code always shows a modal and needs a second click**, even when the file is ready at once; a failure costs two dismissals | Every export | ADR-656 in part | open |
| A4-P2-5 | **In Preview the canvas silently becomes pan-only**, yet Delete and arrows still change the hidden selection | Every session with Preview on | No | open |
| A4-P2-6 | **Ctrl+S does nothing inside Design Studio or Image Studio** (in a browser it opens "Save page as") | Every Studio session | ADR-242, 272 | open |
| A4-P2-7 | **"More cut settings" greys out with no reason during a job or jog**, and an open draft is closed and dropped | Every job | No | open |
| A5-P2-1 | **An autosave failure is said once, in an 8 s toast, with no lasting sign** | Rare, but it is the time that matters | No | open |
| A5-P2-2 | **Jog warnings raise a new long toast on every click** on a machine that has not homed | Every click | Warn-only yes (ADR-232); per-click no | open |
| A5-P2-3 | **Closing with "Don't Save" still brings "Restore it?" at the next launch** | Every unsaved close | ADR-688 decision 3 | PR #1731 (ADR-688 Amd 3) |
| A5-P2-4 | **The same advisories return on every job** for a correct setup: one per traced image, the `$30` note on every unconnected save, the browser keep-awake text | Every job | ADR-687, 224, 117 Amd 1 | open |
| A5-P2-5 | **Step-by-step instructions are shown as toasts that vanish** in 4 or 8 s | Each use of those tools | No | open |
| A5-P2-6 | **Bursts lose messages**: an import or open can raise seven to nine toasts and only three show | Every busy import or open | ADR-687 fixed Save G-code only | open |
| A5-P2-7 | **Nothing lets a user quieten anything**: no notification setting, no "don't ask again" | Always | No | open |

P3 findings are tabled per area in [REPORT.md](REPORT.md).

## Decisions for the maintainer

These rest on an ADR or the maintainer's own earlier instruction, so the audit changed none of them.

**Answered 2026-11-11:** "Change all seven", then "keep the job complete second pass". Six were changed and one is kept.

| ID | Behaviour at the audit | Rule | Decision | Change |
|---|---|---|---|---|
| A2-D-1 | Job Review opens on every Start, including **Run again** of an unchanged job | ADR-224, ADR-237 | Change | PR #1736 (ADR-237 Amd 3): Run again of an unchanged, already-reviewed laser job starts without the dialog. Ordinary Start, CNC, an unverified laser, a changed warning or program, and a reload still review |
| A2-D-2 | Any jog throws a finished Frame away, even when the job is placed by Absolute or User Origin and the jog did not move it | ADR-372, ADR-565 | Change | PR #1733 (ADR-565 Amd 1): a clean XY jog keeps the Frame under Absolute, User Origin or Verified Origin. Current Position, Z or rotary moves, alarms and origin changes still expire it |
| A3-D-1 | Every Abort ends locked in Alarm 3 with a four-button recovery card | ADR-341 Amd 11, ADR-215 Amd 1, ADR-398 Amd 8 | Change | PR #1732, merged (ADR-341 Amd 14): on a laser without homing the origin is restored by itself after the operator's Abort, with no motion. Abort's immediate reset is unchanged |
| A5-D-1 | A 4.75 s splash blocks all input on every launch and reload | ADR-049 Amd 2 | Change | PR #1731 (ADR-049 Amd 3): the full hold only on the first launch of a version; the web app keys on major.minor |
| A1-P2-2 | "Job complete" modal after every laser job | ADR-341 Amd 3, 4 | **Keep** | None. The second-pass offer stays as it is |
| A3-P2-1 | Position hidden after every Unlock | ADR-367 | Change | PR #1735 (ADR-367 Amd 3): kept after a soft limit (ALARM:2) and FluidNC ALARM:17; every other alarm still hides. grblHAL ALARM:13 corrected to position-lost |
| A5-P2-3 | "Don't Save" at close keeps the recovery card | ADR-688 decision 3 | Change | PR #1731 (ADR-688 Amd 3): the copy stays under File > Recover unsaved work; the card stays quiet for it |

None of the six was checked on hardware. Each PR lists what it did not verify.

## Top ten (most likely to annoy a regular user)

1. **A2-D-1 + A1-P2-2:** every repeat run costs a Job Review and then a "Job complete" modal. (The review is removed for repeats by PR #1736; the modal is kept.)
2. **A4-P2-2:** shortcuts go dead after any panel click.
3. **A5-P2-2 + A3-P2-1:** a toast per jog click on a machine without homing, and a hidden position after every Unlock.
4. **A3-P2-2:** quick jog taps are dropped.
5. **A4-P2-4:** Save G-code is always a modal plus a second click.
6. **A4-P2-1:** no autosave while a job runs.
7. **A5-P2-7:** nothing can be turned off.
8. **A2-D-2:** a jog to load the blank cancels the Frame.
9. **A4-P2-3:** locked artwork needs Unlock All.
10. **A5-P2-6 + A5-P2-5:** notices that are lost in a burst or gone before they can be read.

## Suggested fix groups

Each group is one fix session. Wording changes keep G-code byte-identical.

| Group | Findings | Shape of the fix |
|---|---|---|
| F1 In-app confirm, alert and prompt | A1-P2-1, A1-P2-3, A1-P2-4, A1-P3-1 to P3-9, A4-P3-5 | A promise-based confirm/alert/prompt built on `kit/Dialog`, replacing `job-aware-dialogs.ts`. It does not freeze the page, so it need not be refused during a job; it gives named buttons, an inline name field and "don't ask again" |
| F2 Toast store | A5-P2-2, A5-P2-5, A5-P2-6, A5-P3-4, A5-P3-5 | Keyed slots for repeat warnings, lifetime by length, pause on hover, one summary per action, a notice history |
| F3 Notification settings | A5-P2-7, A5-P2-4, A5-P3-1 to P3-3 | Settings > Notifications; remembered dismissals; "seen" folding for repeat advisories |
| F4 Keyboard and canvas | A4-P2-2, A4-P2-5, A4-P2-6, A4-P2-3 | Text-like inputs only block shortcuts; Preview hint and gates; Ctrl+S through modals; per-item Unlock |
| F5 Autosave | A4-P2-1, A5-P2-1 | Autosave during a job through the worker; a status chip while the last write failed |
| F6 Save dialogs | A4-P2-4, A1-P3-9, A4-P3-2 | Open the picker at once when preparation is quick; failure text inside the dialog |
| F7 Jog and Console | A3-P2-2, A3-P2-4, A3-P3-1, A3-P3-4, A3-P3-5 | Fix the step-jog wiring with a `LaserWindow` test; status report after each console `ok`; reasons on disabled controls; plain wording |
| F8 Unlock and holds | A3-P2-3, A3-P3-2, A3-P3-3 (A3-P2-1 wording done in PR #1735) | Resume at an idle door hold |
| Decided 2026-11-11 | A2-D-1, A2-D-2, A3-D-1, A5-D-1, A3-P2-1 (scope), A5-P2-3 changed; A1-P2-2 kept | See the decisions table |
