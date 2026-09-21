# Interface audit and simplification

Date: 2026-09-21. Worktree: `D:\LaserForge\ui-audit-20260921`. Branch: `codex/ui-audit-20260921`.
Starting commit: `377e692baf26a9f66ba3877f157213095c54b92f`, freshly fetched `origin/main`.

**PR integration, 2026-09-22:** the branch subsequently integrated main at
`9d72ba798faf3342efe0f808e1656924e3632b65`. The original 805-control/91-command
matrices remain dated audit snapshots. [The integration supplement](pr-integration.md)
accounts for the Appearance commands and machine-setup redesign, and tests all 94 current commands.
The integrated toolbar preserves Import Image and keeps Image Studio in More. The interface
decision is now ADR-340; main's Appearance decision retains ADR-339.

## Result

**Follow-up completed 2026-09-22:** [the button-by-button functional audit](control-audit.md)
accounts for every one of the 805 catalogue records and all 91 command IDs with specific executed
evidence, expected outcomes, availability and explicit limits. Use its [filterable CSV](control-audit.csv)
or [complete JSON](control-audit.json) to inspect individual controls. The broad suite counts below
describe the earlier UI pass, not proof that every button worked.

The deeper audit repaired three more issues: Image Studio layer actions enabled where they could
do nothing, material wizard Back losing edited settings/details, and camera alignment Save claiming
to show an image without acquiring or enabling it. The material and image-layer fixes also pass
Chrome checks against the production bundle. Camera acquisition remains a mocked boundary.

Implemented a calmer workspace and an explicit acknowledgement for successful jobs. Frequent
actions stay prominent; occasional configuration, history and recovery use named entry points.
At audit completion these changes were local; publication status is tracked by the associated PR.
They have not been hardware-qualified.

The audit catalogues **805 control definitions/calls and 91 registered commands across 22 UI areas**, traces their handlers,
and exercises functional tests across the interface. It does **not** declare every possible control
instance and machine state passed from a source scan. The generated inventory and individual
findings below distinguish source review, automated checks, browser interaction and physical work.

## Deliverables

- [Control catalogue](buttons.md), [filterable CSV](buttons.csv), and [detailed JSON](buttons.json).
  Each record contains source location, handler, availability/help expressions and test pointers.
  The JSON records a digest of the scanned working-tree source, not just its base commit.
- [Button defects and functional evidence](button-findings.md).
- [Toolbar and drawing-palette changes](workspace.md).
- [Completed-job lifecycle and preservation checks](completion.md).
- [Final integration verification and exact commands](verification.md).
- [Reproducible catalogue generator](inventory-buttons.mjs).
- Governing rationale: ADR-340 in `DECISIONS.md`; operator guidance in `WORKFLOW.md`.

## What changed

| Area | Result |
| --- | --- |
| Primary toolbar | Readable Open, Import, Import Image, Save and Preview actions when space permits; selected images bring Trace image into the row. Image Studio stays in More, which retains every secondary toolbar command. |
| Project identity | Project name and an unsaved-change indicator, without adding another action row. |
| Drawing palette | Quiet Edit/Draw groups, consistent target sizes and retained tools, shortcuts and tutorials. |
| Positioning | Jogging and origin retain their existing handlers. Compact contextual lessons replace oversized lesson buttons. Manual Air OFF is a smaller neutral card; setup explanations and switching behaviour remain. |
| Machine actions | Homing/focus and CNC maintenance use a named disclosure. Placement/output, history/recovery and Console stay discoverable. Active recovery and repeat offers remain outside the history disclosure. |
| Frame/Start | Existing actions stay in the dock; their tutorial is beside the readiness explanation. Exact-job Frame, Start-time review and the live Abort/Pause/Resume surface are preserved. |
| Completion | A settled successful job shows Job complete and Done. Done clears the finished preview only; design, undo history, stored execution/replay data, coordinates and Frame state stay intact. |
| Short windows | At 640 px the primary toolbar uses one row. A very short window with persistent banners can scroll the job dock locally so Done and Frame/Start remain reachable. Normal laptop actions remain above the fold. |

## Confirmed defects repaired

1. Image Studio Image/Adjust/Filter menus lacked keyboard navigation, dismissal and stable focus
   after choosing an action. They now support arrow keys, Home/End, Escape/Tab and focus return.
2. Those menus exposed actions during Free Transform that their stores silently refused. They now
   explain the unavailable state and return to normal when the transform ends.
3. Run Order selection was mouse-only. The existing artwork name now provides a native selection
   button that invokes the same action and announces the selection state.
4. Standalone JobControls exposed setup buttons whose missing callbacks silently did nothing.
   They now open the real homing or autofocus target, including while disconnected, while retaining
   existing active-motion restrictions.
5. The finished run had no explicit display-only dismissal. Done now provides it, with fresh run
   identity and settlement checks so stale clicks cannot clear a new or unfinished run.
6. The new completion display initially overflowed the job dock in the 640 × 450 banner-heavy
   browser case. A compact card and local-scroll fallback fixed the reproduced clipping.
7. Image Studio Up/Down and Merge now follow the actual active-layer position, so impossible
   stack-edge actions are disabled instead of silently doing nothing.
8. Material preset Back captures the current step before navigation. Valid settings/details
   survive Back/Next; Cancel keeps the saved preset unchanged.
9. Network camera Save now says “Save alignment” and explains Use this camera, Update still,
   and Overlay on if hidden. It does not promise an unperformed capture/display effect.

The Home click handler also now handles a rejected action promise consistently with the machine
panel; the existing store remains responsible for reporting the error.

**Known unavailable feature:** Focus Test remains deliberately disabled because its dedicated
Z-motion generator has not been implemented/qualified. It is not counted as a working calibration
feature and was not enabled by a styling change.

## Browser evidence

Chrome tests used the repository's disposable browser/platform fixtures. Serial APIs were mocked;
no real controller was requested or operated. The completed screenshots use an explicitly
simulated successful state; the separate real-store GRBL simulator tests exercise actual software
streaming and settlement transitions.

- [Machine panel at 1366 × 900](machine-after.png).
- [Compact layout at 640 × 450](machine-compact.png).
- [Completed job at 1366 × 768, simulated](completed-simulated-laptop.png).
- [Compact dock scrolled to Frame/Start, simulated](completed-simulated-compact.png).
- [User-supplied starting screenshot](user-reference.png), a visual reference rather than verified
  evidence of the freshly fetched baseline build.

The initial browser pass was 18/19: completion overflow was the sole failure. After its repair,
the failed case and three affected disclosure/compact cases passed (4/4). All 19 distinct scenarios
therefore have passing evidence. They include keyboard operation and help focus restoration,
empty Preview through toolbar/menu/shortcut, compact and spacious layouts, panel collapse/reset,
all nine anchors, overflow actions, and light/dark themes. Done preserved the open project and
produced no additional mock-platform events in the browser test.

A broader text/production-workflow pass covered 24 additional scenarios. Eighteen passed initially;
six tests still tried to click Home before opening its new disclosure. The shared browser fixture
was updated to open Homing & focus first, without changing motion or project assertions. All six
passed on rerun, along with the unconfigured-autofocus setup route. This gives **44 distinct passing
browser scenarios** across the integration and workflow batches. A separate smoke check of the
compiled production bundle also passed. Exact commands and remaining boundaries are in
[verification.md](verification.md).

Commands:

```powershell
$env:PLAYWRIGHT_PORT='5186'
pnpm exec playwright test e2e/interface-simplification.spec.ts e2e/ux-shell.spec.ts e2e/preview-entry-parity.spec.ts e2e/workspace-responsive.e2e.ts
pnpm exec playwright test e2e/interface-simplification.spec.ts e2e/ux-shell.spec.ts --grep 'Done clears|routine controls|usable overflow-free|disclosure controls'
```

## Automated verification

These batches overlap; their counts must not be summed as a unique-test total.

| Batch | Result |
| --- | --- |
| Commands, tutorials, libraries and studios | 125 files / 906 assertions initially; five timeout assertions and an obsolete toolbar locator were repaired or passed on targeted rerun. Raw results and exact dispositions are in the button findings. |
| Remaining 13 interface areas | 84 files / 464 assertions passed. |
| Machine controls, jog, origin, live actions and layouts | 30 suites / 134 tests; the sole initial failure was a changed Manual Air label, restored to the established wording and verified on rerun. |
| Setup navigation, JogPad, dock and button help contract | 4 suites / 32 tests passed. |
| Toolbar/palette and associated dispatch | 8 suites / 37 distinct tests passed after entry-point fixture corrections. |
| Completion and settlement | 2 new suites / 30 tests passed, plus existing live controls, repeat and post-job-settle suites. |
| Application and browser TypeScript | Passed; build verification also checks application types. |
| Full application ESLint | Passed. |
| ADR numbers, file-size backstop and export ratchet | Passed. Existing report-only size findings are outside this change. |

Final production build and repository formatting checks passed. Command-audit results and the
complete integration disposition are recorded in [verification.md](verification.md).

## Design study

The layout applies progressive disclosure to occasional actions while keeping frequent work visible.
This follows the guidance in [Nielsen Norman Group's progressive-disclosure study](https://www.nngroup.com/articles/progressive-disclosure/).
[LightBurn's Move window](https://docs.lightburnsoftware.com/latest/Reference/MoveWindow/) and
[Laser window](https://docs.lightburnsoftware.com/1.7/Reference/LaserWindow/) provide a relevant
example of separating positioning from execution. These references informed the hierarchy; the
existing KerfDesk Frame/Start and controller semantics remain the implementation authority.

Finishing a physical run should not silently delete the editable artwork. The chosen default is an
explicit Done acknowledgement that clears the finished preview while preserving the design for
repeat work, adjustment or saving. New/clear-project remains a separate deliberate action.

## Limits and handoff

- Source inventory and automated/browser evidence do not establish that every conditional button
  works in every firmware, native-desktop, camera, imported-file or machine state.
- Physical connection, homing, probing, firing, material cutting, native OS dialogs, updater/install
  flows and production deployment were not exercised. Existing simulator evidence is labelled as such.
- The user's dirty primary checkout and other worktrees were not edited. This change is isolated on D:.
- The local implementation is ready for review; the final checks in `verification.md` are green.
  Publication, merging and a hardware acceptance run remain separate next actions.
