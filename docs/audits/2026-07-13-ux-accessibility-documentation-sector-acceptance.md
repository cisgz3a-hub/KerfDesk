# KerfDesk UX, Accessibility, and Documentation Sector Acceptance

**Date:** 2026-07-13

**Baseline:** 2026-07-11 competitive audit, shipped sector score **6.5/10**

**Candidate stack:** PR #58 through PR #91 + `codex/ux-9-stack-reconcile`

**Status:** Software candidate complete; local full release gate passed; not yet shipped on `main`

## Verdict

The stacked candidate earns **9.1/10** after the exact full release gate passed. It turns
the fixed desktop shell into a responsive, keyboard-operable workspace; keeps the primary machine
actions visible; moves advanced console detail behind a disclosure; and proves accessible names,
focus visibility, canvas rendering, viewport containment, and operator-help entry points in real
Chromium.

This is a software acceptance score. It does not replace testing with screen-reader users, a formal
WCAG conformance audit, translated documentation, or long-term usability studies on production
machines.

## Competitive Boundary

LightBurn supports customizable docked windows, a Window menu, `F12` side-panel toggling, layout
reset, tooltips, shortcuts, and context-sensitive help:
[Customizing the LightBurn Window](https://docs.lightburnsoftware.com/latest/Guides/CustomizingTheLightBurnWindow/)
and [Tips and Tricks](https://docs.lightburnsoftware.com/legacy/TipsAndTricks). xTool Studio
documents a broad keyboard-shortcut surface:
[xTool Studio keyboard shortcuts](https://support.xtool.com/article/2415). Rayforge keeps machine
controls and job progress in a dedicated bottom panel:
[Bottom Panel](https://rayforge.org/docs/ui/bottom-panel/).

KerfDesk's acceptance target is a predictable, responsive workspace for repeated laser and CNC
operation, not arbitrary floating/docking layouts or parity with every competitor shortcut. The
candidate deliberately preserves a visible Stop path while work is active.

## Evidence

| Capability | Candidate evidence | Result |
| --- | --- | --- |
| Responsive workspace | Machine controls start collapsed at 1100 px and below; both rails start collapsed at 700 px and below | Accepted |
| User-controlled layout | Independent named rail controls, checked Window commands, `F12` toggle, and Reset Workspace Layout all use shared state | Accepted |
| Active-job safety | Machine controls remain fail-visible and all combined hide paths are blocked while a job is active | Accepted |
| Toolbar density | The primary toolbar remains one icon-first row; narrow overflow stays inside the command row | Accepted |
| Canvas preservation | Browser assertions retain a usable drawing canvas at 1024 x 700 and 640 x 450 | Accepted |
| Viewport containment | Root geometry owns the full viewport; status bar and primary Frame/Start actions remain inside it | Accepted |
| Progressive disclosure | Advanced machine Console content is collapsed by default without hiding primary setup, motion, or job actions | Accepted |
| Setup clarity | One context-aware Machine Setup entry replaces competing setup paths | Accepted |
| Keyboard access | Panel disclosure, menu commands, toolbar traversal, and `F12` are keyboard-operable | Accepted |
| Focus visibility | Real Chromium verifies a visible focus ring on toolbar traversal | Accepted |
| Accessible naming | Every visible button, input, select, textarea, summary, and link has a computed accessible name in the tested shell | Accepted |
| Operator help | Help exposes connection troubleshooting, safety guidance, and build information; command metadata supplies tooltips and disabled reasons | Accepted |
| Browser rendering | Chromium verifies the workspace canvas is visible and contains multiple sampled colors rather than a blank surface | Accepted |

## Verification

- Focused unit battery: **6 files, 77 tests passed**.
- TypeScript: passed.
- Chromium UX acceptance: **5 workflows passed**.
- Complete Chromium acceptance: **25 workflows passed**.
- Full repository release gate: `pnpm release:check` passed in **10m41s**, including repository
  guards, formatting, licenses, dependency audit, the complete product test suite, web build,
  Electron main build, and both file-size policies.

## Why 9.1

The candidate closes the baseline's central workflow defects: fixed rails no longer consume the
workspace, compact windows remain usable, common commands stay discoverable, advanced controls no
longer dominate the machine rail, focus and naming are browser-tested, and the familiar `F12` plus
reset-layout paths are present. Safety is stronger than a purely cosmetic layout because active
work cannot hide the panel containing Stop.

The score remains below a perfect result because KerfDesk does not offer arbitrary dock/floating
window composition, the help system is task-oriented but not a complete searchable manual, and
assistive-technology and multilingual user studies remain outstanding.

## Score Boundary

- **Shipped `main`: 6.5/10** until the stacked candidate merges and the acceptance suite passes on
  the resulting `main` revision.
- **Stacked software candidate: 9.1/10** with the local full release gate passed.
- Screen-reader user testing, localization, and extended production usability studies remain
  separate acceptance work.
