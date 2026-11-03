# New-user experience audit U1

**Requested:** the maintainer, on 2026-11-03: "next loop. different loop. different area", choosing **New-user experience** from the options offered. The performance audit S1 is paused after its third area ([PR #1553](../2026-11-02-performance-s1/LEDGER.md)).

**Status:** done 2026-11-03; all eight areas ledgered (P1 3 / P2 16 / P3 68). See [LEDGER.md](LEDGER.md#round-summary-2026-11-03).

**The question:** can someone who has never used KerfDesk or LightBurn install it, set up their machine, make a first design and burn it, safely, by following only what the app tells them? Where do they get stuck, misled or put at risk?

Finding IDs are `U<area>-P<n>-<k>`. Temp files are `zz-u<N>-*`, and refuter files `zz-u<N>r-*`.

## Method

[rolling-v2 METHOD.md](../2026-10-21-rolling-v2/METHOD.md) applies: auditor, then a fresh refuter, then a coordinator check in main's code. METHOD §4's pinned citations apply, and LightBurn quotes come from its own documentation, pinned to a version.

**Acting as a beginner.**
- Agents use a production build in Playwright Chromium. Where it is cheap, they also use the packaged desktop app.
- They start from a clean profile (no saved settings, no project) and act as a beginner with no prior knowledge. Each step follows only what the screen says: labels, notices, tooltips and help links.
- When the screen gives no way forward, that is a finding, even if an expert would know the trick.
- Screenshots back every finding.
- Machines are simulated (the repo's controller simulators and fake transports). Hardware is never operated.

**Up to two agents at once.** Nothing is timed, so two may run at once, unlike the performance audit.

**Known material.** Before raising anything, check `docs/audits/2026-07-12-competitive-audit/sectors/18-onboarding-commercial.md`, `docs/audits/2026-07-14-onboarding-device-setup-sector-acceptance.md` and the other audits under `docs/audits/`. Use ADR-500 (first-run machine banner) and ADR-637 (machine setup picker).

## Severity

- **P1:** a beginner cannot get to a first burn by following the app, or is led into a wrong or unsafe burn, or an unsafe machine move, without a warning they would understand.
- **P2:** something blocks or misleads, but there is a workaround a beginner could plausibly find. This includes a message whose words a beginner cannot act on.
- **P3:** polish, wording, layout, or a missing guard or test.

## Areas (run order)

| # | Area id | What a beginner does |
|---|---|---|
| U1 | `install-first-launch` | Downloads and installs the desktop app (read the installer and its first screens), or opens the web app for the first time. Meets the Free / licence window, the first-run machine banner, the empty workspace. |
| U2 | `machine-setup-connect` | Picks their machine (Creality Falcon, xTool, Ortur, Atomstack, Sculpfun, generic GRBL, a Marlin machine, a CNC), installs a USB driver if needed, chooses a port, connects, homes, and understands the bed and origin. |
| U3 | `first-design` | Adds text and shapes, imports an SVG and a photo, assigns operations (Line, Fill, Image), picks power and speed (material library, defaults), and saves. |
| U4 | `first-burn` | Focuses, Frames, presses Start, reads Job Review, watches the burn, pauses, stops, and repeats. What happens when it goes wrong: a bad focus, the wrong origin, a part off the bed, a lost connection. |
| U5 | `errors-recovery` | Meets alarms, homing failures, limit hits, disconnects, a door open, a missing font, an import it can't read. Is each message plain and actionable for a beginner? Does recovery work by following it? |
| U6 | `help-discoverability` | Looks for help: tooltips, help links, search, settings, keyboard shortcuts. Can they find the feature they need, and is the documentation reachable and right? |
| U7 | `accessibility-small-screens` | Uses the app keyboard-only and with a screen reader (labels and roles, read from the accessibility tree), checks colour contrast, on a 1366 × 768 laptop and on the phone remote. |
| U8 | `lightburn-beginner-path` | Compares KerfDesk's path with LightBurn's documented beginner path (its own docs, pinned): where LightBurn guides a beginner and KerfDesk doesn't, and the reverse. Where do beginners of either get stuck, from public forums, read only? |

## Result

Each area report gives:
- the beginner's journey as numbered steps, with screenshots: what they saw, what they did, and where they got stuck;
- findings with the usual auditor, refuter and coordinator checks.

The round summary ranks the ten things most likely to stop a beginner's first burn.

## Fix cards

Each brief names:
- the beginner's goal, the screen and the exact words involved;
- every sibling route (other machines, web and desktop, both themes, small screens);
- a test that drives the journey.

Wording changes keep the burn byte-identical.
