# UX audit U1 — P3 sweep, areas U5–U8

Maintainer request (2026-11-04): "fix the P3s". This file lists every P3 in [U5](U5-errors-recovery.md), [U6](U6-help-discoverability.md), [U7](U7-accessibility-small-screens.md) and [U8](U8-lightburn-beginner-path.md), each checked against `origin/main` (`9372060f7`, 2026-11-05), and where it was fixed. U1–U4's P3s are a separate sweep; it handed U4-P3-2 and U4-P3-4 to this one, since they are the same bugs as U5-P3-5 and U5-P3-2.

No KNOWN item in U5–U8 carries a refuter recommendation to fix beyond its own P3: the only one, U6's "the 'frame' placeholder should still be fixed", is U6-P2-1 itself (now P3). The KNOWN items re-observed in these areas belong to other areas' ledgers (U1–U4, rolling audits) and are tracked there.

Status key: **already fixed (#N)** on main before this sweep; **this sweep (#N)**; **maintainer decision** (why, with a recommendation); **refuted**.

**Sweep PRs:** #1580 file and crash messages (merged); #1595 controller messages; #1598 help and search (wider Ctrl+K, ADR-604 Amendment 1, the maintainer's choice of 2026-11-05); #1604 accessibility and small screens; #1605 the LightBurn beginner path. The repository was private during the sweep, so the open PRs wait for auto-merge until the ruleset is enforced again.

**Follow-ups owed:** a Worker redeploy so phones get #1604's remote-app CSS (U7-P3-8).

## U5 — Errors and recovery

| ID | Title | Status |
|---|---|---|
| U5-P3-1 | An alarm raised while the Artwork tab is open shows nowhere until Frame is pressed | this sweep (#1595) |
| U5-P3-2 | The critical-alarm card hides each alarm's own advice, and after Reset still says "press Reset" | before-Reset half: already fixed (#1569). After-Reset half (= U4-P3-4, handed to this sweep by the U1–U4 sweep): this sweep (#1595) |
| U5-P3-3 | Homing-failure alarms (8, 9) advise `$` settings and offer Home again | this sweep (#1595) |
| U5-P3-4 | On the stock GRBL driver, a grblHAL E-stop reads "Alarm 10: Homing fail — dual-axis switch" | this sweep (#1595) |
| U5-P3-5 | An idle door hold says "release it with cycle start" | already fixed (#1569, unowned bar). The owned-bar twin (= U4-P3-2, handed to this sweep): this sweep (#1595) |
| U5-P3-6 | A Marlin halt is titled "Controller rejected a command", and the rail keeps "State: Idle" | title: already fixed (#1559, "Controller halted: press its reset button"). Rail state: this sweep (#1595) |
| U5-P3-7 | "Use detected Marlin in draft" changes a working 115200 connection to 250000 | this sweep (#1595) |
| U5-P3-8 | A damaged or empty project gives a JSON parser message | this sweep (#1580) |
| U5-P3-9 | A missing font opens with "Success"; the reason is off-screen and names "Relink" | this sweep (#1580) |
| U5-P3-10 | SVG import errors are XML-parser text with no next step | this sweep (#1580) |
| U5-P3-11 | Save failures show the browser's exception text | this sweep (#1580) |
| U5-P3-12 | "Error: Error: …" toasts, and a crash screen that leads with a stack trace | this sweep (#1580) |
| U5-P3-13 | A second rejected setting write does not replace the first notice | this sweep (#1595) |

## U6 — Help and discoverability

| ID | Title | Status |
|---|---|---|
| U6-P2-1 → P3 | Find a command can't find Frame, Set origin, Machine Setup…; its example "frame" returns Wireframe View | this sweep (#1598). The maintainer chose on 2026-11-05 to widen Ctrl+K to panel actions, ranked lessons and Settings entries (ADR-604 amendment) |
| U6-P3-1 | Learn's search is an unranked substring filter | this sweep (#1598) |
| U6-P3-2 | Keyboard Shortcuts can only be found through a lesson; the icon's hover is the whole list; F12 missing | this sweep (#1598) |
| U6-P3-3 | Six lessons name a control by a word the screen doesn't use | this sweep (#1598) |
| U6-P3-4 | Sixteen lessons teach Pro tools to Free users with no Pro mark | this sweep (#1598) |
| U6-P3-5 | The photo lesson never mentions the Photo engraving window | this sweep (#1598) |
| U6-P3-6 | Path text is greyed with no reason until a path exists | this sweep (#1598) |

## U7 — Accessibility and small screens

| ID | Title | Status |
|---|---|---|
| U7-P3-1 | Focus falls to `<body>` after Set origin here, Frame job, Start job and Pause | Start job and Pause: already fixed (#1570). Frame job and Set origin here: this sweep (#1604) |
| U7-P3-2 | The fixed Live Motion bar hides focused controls and dialog footers at laptop heights | this sweep (#1604) |
| U7-P3-3 | ABORT JOB and Pause don't name their keyboard shortcut | already fixed (#1570: ABORT names Ctrl+. in its hover and `aria-keyshortcuts`; Pause has no shortcut to name) |
| U7-P3-4 | Dark theme: the copper focus ring is 2.79 : 1 | already fixed (#1570, `--lf-focus-accent`) |
| U7-P3-5 | Dark theme: disabled buttons look enabled | this sweep (#1604) |
| U7-P3-6 | The canvas's name is not exposed | refuted (Chromium exposes it); the remaining half is folded into U7-P3-10 |
| U7-P3-7 | Status-bar messages are cut off at 1366 px and below | this sweep (#1604) |
| U7-P3-8 | Phone remote polish at 375 px | this sweep (#1604) |
| U7-P3-9 | Two small light-theme text misses in Job Review | this sweep (#1604) |
| U7-P3-10 | The draw tools have no keyboard route, and don't say so | this sweep (#1604) |

## U8 — LightBurn beginner path

| ID | Title | Status |
|---|---|---|
| U8-P3-1 | No lesson takes a beginner from machine to a finished burn ("Burn your first coaster") | this sweep (#1605) |
| U8-P3-2 | Material Test's Cut keeps the engraving ranges; no reading or safety text | this sweep (#1605): reading and safety lines, the stale lesson tip, and an opt-in **Use cut starting ranges** (100 %, 60–600 mm/min, 1–5 passes, LightBurn's advice). Maintainer decision: whether Cut should start on those ranges by default. Recommendation: yes, once a diode and a CO2 profile split them, since one default serves both today |
| U8-P3-3 | The origin picker never says what a wrong corner does | this sweep (#1605) |
| U8-P3-4 | The Speed box refuses "100 mm/s" | this sweep (#1605) |
| U8-P3-5 | The setup card keeps saying "Machine type set to CNC" | already fixed (#1567) |
