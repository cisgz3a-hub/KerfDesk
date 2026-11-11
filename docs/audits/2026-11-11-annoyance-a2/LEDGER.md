# User annoyance audit A2 (round two) — ledger

**Requested by** the maintainer on 2026-11-11: "what else can annoy", then "Yes, audit them" for the areas round one skipped.

**Tree.** `origin/main` @ `95489484e`. Evidence and method: [REPORT.md](REPORT.md). Round one: [../2026-11-11-annoyance-a1/LEDGER.md](../2026-11-11-annoyance-a1/LEDGER.md).

**Limits.** Static read only: nothing was run, no phone, browser, installer or live service was used. Every P1 and P2 was re-read in `main`'s code by the coordinator. There was no refuter pass, so ratings are provisional until a fix session reproduces each finding. Findings marked "runtime check owed" rest on reading alone.

## Verdict

Round one found nothing that stops a user outright. Round two found two things that can, both by reading and both still to be reproduced:

1. **A multi-bit CNC job appears unable to continue past a bit change** unless the next bit is already the project's Default bit (B4-P1-1).
2. **In the web app, one click on Update during a job reloads the page and stops the burn** (B1-P1-1). Your own ADR-561 Amendment 7 records this as open.

The rest is friction, and most of it sits at the edges of the product: the phone remote, firmware other than stock GRBL, licence messages, and the feel of everyday editing. Four causes recur:

1. **State that is forgotten when it need not be.** Touch-plate numbers, camera calibration power, camera picture visibility, the "camera moved" dismissal, new-project stock, a recovered project's file name.
2. **Messages that do not reach the user or do not last.** Licence messages wiped within 30 seconds, phone reasons hidden in hover tooltips, a silent seat removal, a silent pairing expiry.
3. **Firmware other than stock GRBL treated as permanently unverified**, with GRBL wording it cannot act on.
4. **Pointer input that acts too early**: a move with no drag threshold, a right-click that reselects, a paste that ignores the pointer.

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
| B1 | Browser prompts, installing and updating | 12 | 1 | 4 | 7 | 0 |
| B2 | Licences, trials, activation and check-ins | 15 | 0 | 7 | 8 | 0 |
| B3 | Machine, camera and rotary setup | 14 | 0 | 6 | 8 | 0 |
| B4 | CNC flows | 14 | 1 | 4 | 8 | 1 |
| B5 | The phone remote | 19 | 0 | 10 | 8 | 1 |
| B6 | Editing feel and waiting | 19 | 0 | 7 | 11 | 1 |
| **Total** | | **93** | **2** | **38** | **50** | **3** |

## P1 findings (coordinator-read)

| ID | Summary | How often | Deliberate? | Fix status |
|---|---|---|---|---|
| B4-P1-1 | **A multi-bit CNC job cannot Continue past a bit change** unless the next bit already is the project's Default bit. Continue needs Work Z tagged with the pending bit; Zero Z and the probe tag it with the project's bit; the only control that changes that bit is in Machine Setup, whose Save is refused during a job. **Reproduced** on the GRBL simulator through the rendered Machine rail (main 06d947672): after Zero Z or a Z probe at the hold the record is for the Default bit and Continue reads "Work Z belongs to a different bit" | Every bit change of a project Start | ADR-416 Amd 1, 3 in part | **fixed** in PR #1769, ADR-416 Amendment 4: the bit in the spindle is session state, a hold declares the bit it asked for, and the rail has a Bit in the spindle selector; the Continue check is unchanged. Simulator tests only, no hardware |
| B1-P1-1 | **Web: one click on Update during a job reloads the page and stops the burn.** No job check, no question | Rare click; the button is present most days | ADR-227, ADR-228; ADR-561 Amd 7 names the guard as open | maintainer said "Yes, make it wait" (2026-11-11); fixed by ADR-227 Amd 2 |

## P2 findings (coordinator-read)

| ID | Summary | How often | Deliberate? | Fix status |
|---|---|---|---|---|
| B1-P2-1 | **Recovered work comes back nameless and cut off from its file**, so the next Save offers `untitled.lf2` | Every recovery | No | open |
| B1-P2-2 | **Windows: every update is the whole installer again**, licence page included, and a download not installed is deleted at the next launch | Each release | ADR-561 dec 3, 4 | open; needs the maintainer's word |
| B1-P2-3 | **Web: Save over an opened project asks for permission late** and may fail for big projects. Runtime check owed | Each Save of a large project | ADR-378, ADR-550 in part | open |
| B1-P2-4 | **Mac: about ten steps per update, and two different sets of instructions on one page** | Each release, Mac users | Unsigned build is known | open |
| B2-P2-1 | **Licence messages vanish within 30 seconds, or when the user switches windows**, including the instruction shown after Buy Pro. Runtime check owed | Every failed activation and every purchase | No | open |
| B2-P2-2 | **"Deactivate this device" is one click, forgets the saved key, and cannot be undone offline** | Rare; costly | Locking at once yes; no confirmation no | open |
| B2-P2-3 | **A paying user whose seat is removed elsewhere silently becomes "Free · Try Pro"** and is offered a trial | After any remote removal | Revocation yes; silence no | open |
| B2-P2-4 | **A trial needs the internet every three days; nothing says so beforehand**, and the failure text contradicts itself | Every offline trial user, from day 4 | ADR-592, ADR-623 Amd 2 | open |
| B2-P2-5 | **After Pro ends, editing Pro artwork answers "V-carve is a Pro tool" with no reason, and the edit is dropped** | Every ended-trial user with a Pro project | ADR-592 | open (wording) |
| B2-P2-6 | **Manage devices lists every computer as "Windows computer"** and does not mark this one | Every user at the seat limit | Privacy choice | open |
| B2-P2-7 | **The app says to find the key in "your email", but the checked-in service configuration sends no key email.** Live setting not checked | Every lost key | ADR-579 not switched on | open |
| B3-P2-1 | **A Marlin or Smoothieware laser is told "Controller settings cannot be fully verified" on every job**, with GRBL advice it cannot follow; it also never gets the Run again shortcut | Every job | In part (ADR-095, ADR-224) | open |
| B3-P2-2 | **A homed grblHAL, FluidNC, Marlin or Smoothieware machine can never earn a "verified" bed position**; click-to-move is refused with a hint that is untrue for it | Every session and job | ADR-322 Amd 3 covers one machine only | open |
| B3-P2-3 | **"Machine settings detected … updates are ready" returns on every connect** when the difference is intended | Every connect for those setups | ADR-611 Amd 2 | open; needs the maintainer's word |
| B3-P2-4 | **A calibrated camera puts every non-Absolute job under a camera warning**, and hiding the picture is forgotten each session | Every job for camera owners placing by origin | ADR-663 Amd 1, 4 | open; needs the maintainer's word |
| B3-P2-5 | **The quick camera fix burns its ring at default power after a restart**, and calls that "the calibration target's settings" | Each fix after a restart | No | open |
| B3-P2-6 | **Every calibration helper takes over the canvas** (material, interval, focus, rotary, camera target) | Each new material or lens | No | open |
| B4-P2-1 | **Every CNC Abort resets mid-motion**: alarm card, XY origin, Work Z and Frame all go. The Zero Z button uses the volatile `G92`, so Abort destroys the zero that button set | Every Abort | ADR-398 Amd 8, ADR-215 Amd 1 | open; hold-first needs the maintainer's word |
| B4-P2-2 | **Touch-plate numbers go back to defaults after every controller reset and every New or Open** (15 mm against a real 19 mm plate lands Z 4 mm off) | Every session and stop | No | open |
| B4-P2-3 | **Each new project starts on factory stock and bit**, and stock can only be changed through Machine Setup | Every project | ADR-306 | open |
| B4-P2-4 | **Work Z must be proved again after events where the controller may still hold it**, and the read-back shortcut sits under "Advanced" behind a native confirm | Every session and stop | ADR-192, ADR-228 | open |
| B5-P2-1 | **A phone review that changes, is blocked or is closed leaves the phone stuck**, with a spinner or "That value isn't accepted" and Abort as the only exit | Any job where something changes after Review | Gate yes; phone tracking no | open |
| B5-P2-2 | **The pairing ends silently on a fixed clock** (8 hours or 30 days), even mid-job; Pause and Abort vanish from the phone | Every working day without the 30-day tick | Lifetimes yes (ADR-583); silence no | open |
| B5-P2-3 | **An alarm is a dead end on the phone**: no Unlock, and Home is greyed although the PC allows it | After every alarm | No | open |
| B5-P2-4 | **Pairing asks for the permissions twice, unticked on the PC, and a missed tick means pairing again** | Every pairing | ADR-569, ADR-583 | open; needs the maintainer's word |
| B5-P2-5 | **Greyed buttons and refusals do not say why in words a phone user can see** (reasons in hover tooltips; "This information is not currently available.") | Every session | No (ADR-582 promises visible reasons) | open |
| B5-P2-6 | **The red Abort dock stays on screen after a phone-started job longer than about three minutes**; one tap sends a real Abort | Every such job | No | open |
| B5-P2-7 | **Quick step taps are refused, and a minute of nudging can hit the request limit.** Runtime check owed | Every positioning session | No | open |
| B5-P2-8 | **A closed or sleeping PC is reported as "may have received that"**, and the stale screen keeps its buttons enabled | Whenever the PC is away | No | open |
| B5-P2-9 | **During a job the phone can sleep, and the result is a 3.5 s toast** with no lasting record | Every job watched from the phone | No | open |
| B5-P2-10 | **A CNC tool-change hold shows as "Running"**, with nothing to do | Every bit change | No | open |
| B6-P2-1 | **A right-click throws away a multi-selection**, then offers Group and Align | Every right-click on a multi-selection | No | open |
| B6-P2-2 | **Click tolerance is a fixed 2 mm of artwork, not screen pixels**; a press inside any outline grabs it | Every edit at high or low zoom | ADR-196 in part | open |
| B6-P2-3 | **No drag threshold**: a click that slips one pixel moves the artwork, and snapping can make it jump | Every session | No | open |
| B6-P2-4 | **Paste always lands at "source + 10 mm"**, so repeated pastes stack exactly and a paste can land off-screen | Every multi-paste | No | open |
| B6-P2-5 | **The pen tool cannot take back one point**; Esc discards the whole draft | Every pen drawing | No | open |
| B6-P2-6 | **On a small selected object the resize handles cover the whole body** | Every edit of small parts | No | open |
| B6-P2-7 | **A decimal comma is refused everywhere** | Every number, comma-locale users | By code comment | open |

P3 findings are tabled per area in [REPORT.md](REPORT.md).

## Decisions for the maintainer

Each rests on an ADR or the maintainer's own instruction. None is changed by this audit.

| ID | Current behaviour | Rule | Option |
|---|---|---|---|
| B1-P1-1 | The web Update button reloads during a job | ADR-227, ADR-228, ADR-561 Amd 7 dec 7 | **Decided 2026-11-11: make it wait.** ADR-227 Amd 2 |
| B4-D-1 | On a CNC any Z move after Frame expires the Frame | ADR-565 Amd 1 | Keep the Frame through an app-owned Z jog; still expire on Zero Z, probe, origin change, alarm, reset |
| B5-D-1 | No "Run again" on the phone | ADR-237 Amd 3 | A carried review with the slide kept as the one gesture |
| B6-D-1 | A two-finger trackpad scroll zooms the canvas and cannot pan | ADR-359 Amd 2 | Pinch zooms, two-finger scroll pans, as the trace preview does |
| B1-P2-2 | Every Windows update runs the full interactive installer; unused downloads are deleted | ADR-561 dec 3, 4 | Skip the licence and location pages on an update; keep a verified download |
| B3-P2-3 | "Machine settings detected" repeats for intended differences | ADR-611 Amd 2 | Say an unchanged offer once per profile; add "Keep my values" |
| B3-P2-4 | A camera picture switches camera placement on at every launch | ADR-663 Amd 1, 4 | Remember visibility per machine; switch on when artwork is moved under the picture |
| B4-P2-1 | CNC Abort resets at once | ADR-398 Amd 8; ADR-215 Amd 1 (deferred) | Hold first, then reset, for CNC |
| B5-P2-4 | Pairing scopes start unticked and cannot be changed later | ADR-569, ADR-583 | Let the PC change scopes on an existing connection |

Also for the maintainer: `AGENTS.md:34` says devices check in "paid 30 days, trial 3 days". ADR-623 Amendment 2 removed the paid check-in.

## Corrections to round one

- **A5-P3-6** said every licence failure reads "This request could not be completed. Please try again." Service refusals have about 30 specific messages; that text shows only when the app's own call throws. The real problem is B2-P2-1.
- **A5 "checked and sound"** said there are no system notifications. The desktop app raises one for an update (B1-P3-1).

## Top ten (most likely to annoy a regular user)

1. **B4-P1-1:** a multi-bit CNC job that cannot continue past its bit change.
2. **B6-P2-3 + B6-P2-1 + B6-P2-2:** artwork that moves on a click, a right-click that drops the selection, and a click target sized in millimetres.
3. **B3-P2-1 + B3-P2-2:** Marlin, Smoothieware, grblHAL and FluidNC users told "unverified" on every job, for good.
4. **B4-P2-1 + B4-P2-2 + B4-P2-4:** what one CNC stop costs, and re-typing the touch plate each time.
5. **B5-P2-1 + B5-P2-2:** a phone review that sticks, and a pairing that ends without a word.
6. **B2-P2-1:** licence messages that vanish before they can be read.
7. **B1-P1-1:** the web Update button during a job.
8. **B6-P2-4 + B6-P2-5:** paste that stacks copies invisibly, and a pen that cannot undo one point.
9. **B3-P2-4 + B3-P2-6:** the camera warning on every job, and test patterns that replace the artwork.
10. **B1-P2-1:** recovered work that has lost its file name.

## Suggested fix groups

Each group is one fix session. Wording changes keep G-code byte-identical.

| Group | Findings | Shape of the fix |
|---|---|---|
| G1 CNC bit change | B4-P1-1 | Reproduce on the simulator through the interface first. Bind Zero Z and the probe at a hold to the pending bit; keep "bit in the spindle" as session state |
| G2 CNC stops and Z | B4-P2-1 (stored Zero Z, read-back), B4-P2-2, B4-P2-4, B4-P3-1, B4-P3-7 | Zero Z as a stored offset; plate numbers on the machine profile; one inline "controller still holds Z0" line |
| G3 Pointer feel | B6-P2-1, P2-2, P2-3, P2-6, B6-P3-9 | A drag threshold; pick tolerance in pixels; right-click keeps a selection it hits |
| G4 Paste, pen, numbers | B6-P2-4, P2-5, P2-7, B6-P3-2, P3-3 | Paste at the pointer; pen takes back a point; accept a lone decimal comma |
| G5 Non-GRBL firmware | B3-P2-1, B3-P2-2 | Own wording for firmware without settings; a per-machine statement of the bed mapping |
| G6 Phone tracking and words | B5-P2-1, P2-5, P2-6, P2-8, P2-10, P2-3 | Read the operation from status replies; visible reasons; an offline answer; a tool-change title |
| G7 Phone session | B5-P2-2, P2-7, P2-9, B5-P3-2, P3-5 | Show and warn of expiry; queue one step; wake lock; reconnect on wake |
| G8 Licence messages | B2-P2-1, P2-2, P2-3, P2-5, P2-6, B2-P3-1 to P3-5 | Keep the last action's message; confirm Deactivate; say why a seat went; mark this computer |
| G9 Licence trial and key | B2-P2-4, P2-7, B2-P3-6 | Say the three-day rule and show the next check-in; "Save key to a file" |
| G10 Recovery and save in the browser | B1-P2-1, B1-P2-3 | Keep the file name in the autosave; ask for edit permission before preparing |
| G11 Camera and calibration memory | B3-P2-5, B3-P2-6, B3-P3-1, P3-2, P3-7 | Remember engrave settings; run tests as a temporary job; save the "moved" dismissal |
| G12 CNC project defaults | B4-P2-3, B4-P3-4, P3-5 | Seed New from the last setup; editable stock chip; feed-ceiling note; operation names in warnings |
| Needs the maintainer first | B1-P1-1, B4-D-1, B5-D-1, B6-D-1, B1-P2-2, B3-P2-3, B3-P2-4, B4-P2-1 (hold first), B5-P2-4 | See the decisions table |
