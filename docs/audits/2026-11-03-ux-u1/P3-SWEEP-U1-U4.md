# P3 sweep — UX audit U1–U4

The maintainer asked to "fix the P3s" (2026-11-05). This file records every P3 in [U1](U1-install-first-launch.md), [U2](U2-machine-setup-connect.md), [U3](U3-first-design.md) and [U4](U4-first-burn.md), the two P2s their refuters lowered to P3 (U3-P2-1, U4-P2-2), and the KNOWN items a refuter asked to fix. The [ledger](LEDGER.md) still holds the P1s and P2s, all fixed.

Status is one of: **already fixed (#N)** by an earlier PR, **fixed by this sweep (#N)**, **handled by the U5–U8 sweep (#N)** where that sweep owns the same bug, or **maintainer decision**, with a one-line recommendation. A P3 that would change the burn or motion, change a default users rely on, or needs a product choice is left as a decision, not changed.

No sweep PR changes G-code: every change is a label, notice, tooltip, hint or lesson text, plus one Machine Setup default for a new CNC preset (the untouched stock size).

## U1 Install and first launch

| ID | Title | Status |
|---|---|---|
| U1-P3-1 | The web app calls itself `v0.1.5196`; the desktop and download page use `1.0.x` | **Maintainer decision.** The number also feeds the G-code `; version:` header and the packaged-metadata check, so renumbering is a release choice. Recommendation: label the web build from the desktop release line ("Web · 1.0.29 + 12"). |
| U1-P3-2 | Red "Relative view — physical bed position unverified" with no tooltip | Already fixed (#1554): plain-words tooltip. |
| U1-P3-3 | WORKFLOW F-A1/F-A2 describe a first run that no longer exists | Already fixed (#1554). |
| U1-P3-4 | Units can't be found by searching "units" or "inch" | Already fixed (#1554). |
| U1-P3-5 | The desktop toolbar shows "MCP" to every new user | Fixed by this sweep (#1581): the hover says what it is for. **Maintainer decision** on the label itself, kept on purpose by #1166/#1177. Recommendation: rename it **Phone**, keeping MCP in the hover. |
| U1-P3-6 | Open and Save dialogs call KerfDesk projects "Files" | Fixed by this sweep (#1581): the type name comes from the extensions ("KerfDesk project", "G-code", "SVG drawing"). |
| U1-P3-7 | No plain meaning for G-code, GRBL, homing, origin or kerf | Already fixed (#1554): "Words you'll see" lesson. |
| U1-P3-8 | Marketing site copy contradicts the real install (not deployed) | Already fixed (#1554). |
| U1-P3-9 | Neither first-contact screen points to how to start | Download-page half already fixed (#1554); welcome-card half fixed by this sweep (#1581): "New to KerfDesk? Click Learn (top right), then Make your first project: 4 minutes, no machine needed." |

U1 KNOWN with a refuter fix request: "Can't connect?" ends in a repository path (S12-F1). Already fixed (#1559): in-app dialog linking the published guide.

## U2 Machine setup and connect

| ID | Title | Status |
|---|---|---|
| U2-P3-1 | An unlisted machine filled from its controller is saved as "Default 400×400" with a different bed | Fixed by this sweep (#1588): the fill renames the starter to "My machine". |
| U2-P3-2 | Review says "Ready to save … internally consistent" for starter guesses | Fixed by this sweep (#1588): Review names an untouched starter work area or power scale (and a firmware starter's bed) as starter guesses; Save stays enabled. |
| U2-P3-3 | Toolbar and sidebar say "Connected" while setup says "Your machine didn't answer" | Fixed by this sweep (#1588): "Port open, no answer" in the sidebar and Machine Setup. The toolbar says "No answer" (#1599), because the long form widened the connection row when the recovery card opened (ADR-642). |
| U2-P3-4 | Duplicate toasts with controller jargon; Marlin speaks GRBL | Jargon already fixed (#1559). Duplicate fixed by this sweep (#1588): the settings-read card is one keyed slot. |
| U2-P3-5 | 3018-PRO preset: stock 400 × 400 on a 300 × 180 machine; Frame feed 6000 above the 1000 output max | Stock fixed by this sweep (#1588): an untouched default stock shrinks to the preset's work area. **Maintainer decision** on the Frame feed: Frame is capped only by the controller's live `$110`/`$111`, not by the profile maximum, so lowering it changes real Frame motion. Recommendation: cap a CNC preset's Frame feed at its output maximum when the preset is applied. |
| U2-P3-6 | Connection help ends with a repo path, is a native alert, unreachable in Machine Setup | Already fixed (#1559): in-app dialog, published link, **Can't connect?** in the setup strip. |
| U2-P3-7 | Start-from modes explained only by one combined tooltip | Fixed by this sweep (#1588): a line under Start from says what the chosen mode does with the canvas place; each option has its own hover. |
| U2-P3-8 | Brand families with no row (Falcon A1, Falcon 2, Atomstack, generic diode) | Fixed by this sweep (#1588): a search finding three rows or fewer names them and points other models at My machine isn't listed. |
| U2-P3-9 | Console decode of `error:5` says "Set $22=1 first" with no word on switches | Already fixed (#1559). |

U2 KNOWN raised to P2 (empty port picker, web): already fixed (#1559).

## U3 First design

| ID | Title | Status |
|---|---|---|
| U3-P2-1 (P3, refuter) | Starter power and speed never called starter values | Already fixed (#1561): starter-values notice on the Operation panel. |
| U3-P3-1 | 100 % at 100 mm/min accepted with no notice; nothing explains power and speed | Tooltips fixed by this sweep (#1581). **Maintainer decision** on the power ÷ speed notice: it needs a dose threshold per machine and material. Recommendation: a Job Review warning when power ÷ speed exceeds the Material Test's highest cell for that machine. |
| U3-P3-2 | Aspect lock off by default, so typing a photo's width squashes it | Fixed by this sweep (#1581): the lock names its state, and a photo stretched by one typed side says how to undo it. **Maintainer decision** on the default: off is deliberate (LightBurn parity). Recommendation: lock by default for images only. |
| U3-P3-3 | Plain-ink canvas but lesson says colours identify operations; Alt peek undocumented; imports named "logo 1, 2, 3" | Lesson tip and Keyboard Shortcuts fixed by this sweep (#1581). **Maintainer decision** on naming imported operations by role (a naming convention saved in projects). Recommendation: "logo · fill (black)". |
| U3-P3-4 | Draw ellipse doesn't say Shift for a circle | Fixed by this sweep (#1581): also Shift for a square and Ctrl from the centre. |
| U3-P3-5 | Photo job shows "large job"/"traces"; Preview banner in compiler terms | Fixed by this sweep (#1581): "time: see Preview" and a plain banner. |
| U3-P3-6 | Save G-code's three-toast cap hides the beginner warning and the success | Already fixed (#1561). |

## U4 First burn

| ID | Title | Status |
|---|---|---|
| U4-P2-2 (P3, refuter) | Focus is one grey line under the jog pad | Already fixed (#1566): focus hint and the Before you start block. |
| U4-P3-1 | Pause shows "Door"; its tooltip says "feed hold only" | Fixed by this sweep (#1609). |
| U4-P3-2 | A machine door hold says "Release it with cycle start" and offers no Resume | Handled by the U5–U8 sweep (#1595): same text and fix as U5-P3-5. |
| U4-P3-3 | Stale state: "Frame expired" during a run; "Run" after Abort, alarm or a pulled cable | Fixed by this sweep (#1609). |
| U4-P3-4 | ALARM:1 card still says "press Reset" after Reset; re-home with homing off | Handled by the U5–U8 sweep (#1595): same bug as U5-P3-2. |
| U4-P3-5 | Cable-pulled card: moving, not burning; "Reconnect and home" with no homing | Fixed by this sweep (#1609). |
| U4-P3-6 | Frame and origin wording; stale "Last Frame attempt blocked" | Fixed by this sweep (#1609). |
| U4-P3-7 | Job Review mixes coordinate frames | Fixed by this sweep (#1609): the size range is labelled G-code, out-of-bed lines bed positions. |
| U4-P3-8 | The first "Job complete" is a modal about a second pass | Fixed by this sweep (#1609): leads with "The job finished and the laser is off." and names Run same job again. The modal stays (its focus rule is ADR-341 Amendment 3). |

## Tally

34 P3s (including the two refuter-lowered P2s): 10 already fixed by #1554, #1559, #1561 and #1566; 21 fixed in whole or in part by this sweep; 2 owned by the U5–U8 sweep; 1 left only as a decision (U1-P3-1). Maintainer decisions: 6 (U1-P3-1, the MCP label, the 3018 Frame feed, the power ÷ speed notice, the image aspect-lock default, operation names by role).

Merge status (2026-11-09): all merged: #1581, #1588, #1599, #1609 and #1610, and the U5–U8 sweep's #1595. The sweep is closed; only the six maintainer decisions above remain.
