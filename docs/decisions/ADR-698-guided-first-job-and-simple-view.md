## ADR-698 - A guided first job and a Simple view for new operators (2026-11-10)

**Status:** Accepted. Extends ADR-348 (where tutorials live) and ADR-430 (the laser artwork
inspector). Leaves ADR-565 and PROJECT.md non-negotiable 21 unchanged: a completed Frame of the
unchanged footprint and placement is still the only ordinary Start gate, and Job Review is still the
one warning surface. | **Date:** 2026-11-10

### Context

A competitor scorecard rated KerfDesk's ease of learning 6 out of 10, against 9 for xTool Creative
Space and Easel. A new operator meets many dialogs and dense settings before a first burn. KerfDesk
already teaches the path in the Learn lesson "Burn your first coaster" (`first-burn-tutorial.ts`,
U8-P3-1), but a lesson is a modal of illustrations: the operator reads it, closes it, and then has
to find each real control alone. The artwork inspector (ADR-430) already keeps the process, Power,
Speed and Passes on top, but every process option, the one-line switches and the way into Cut
Settings sit under them, and a first-time operator cannot tell which of them matter.

The scorecard's gap is fewer dialogs and less settings text in front of a first job. This decision
closes it without moving any safety boundary: a guide that points at the real controls, and a view
that hides settings a first job leaves at their usual values.

### Decision

1. **Guided first job.** Help → **Guided first job…**, the "Guide me in KerfDesk" button on the
   "Burn your first coaster" lesson, and Ctrl+K open a non-modal side panel
   (`src/ui/first-job/`). It lists six steps: **Connect**, **Choose your machine**, **Put
   something on the canvas**, **Pick a material preset**, **Frame it**, **Start and stay with it**.
   - Each step is done when the app's own state says so: the controller connection; the saved
     Machine Setup mark for the connected profile and controller (`deviceProfileSignature`, the
     mark the "This machine isn't set up yet" nudge reads); any artwork in the scene; a chosen job
     material, or an output operation that artwork uses which holds or links a preset of the open
     library; the same Frame evidence Start uses (`currentCompletedFrame` and
     `framedRunReadinessIssue`); a streaming, paused or tool-change job. The current step is the
     first one not done, so an edit that expires the Frame brings the guide back to Frame.
   - The current step's real control is outlined (a `data-first-job-target` attribute on `body`
     and the controls' existing `data-search-target` names). **Show me** opens the panel at that
     control and focuses it through the command-search reveal (ADR-604 Amendment 1); it never
     presses it.
   - The guide never connects, frames, starts, homes or changes a setting. Its one write is **Add
     a sample circle**: a 40 mm ellipse in the middle of the bed, placed through the ordinary
     `drawShape` path when the operator presses it, one undo step.
   - **Choose your machine** and **Pick a material preset** can be skipped, for an operator who
     uses settings from the laser's maker or a material test. Frame and Start cannot: they wait
     for the real state.
   - The guide adds no Start guard and no refusal. Start is gated by the Frame as before, and its
     warnings are in Job Review as before. The panel sits under every dialog and toast
     (`--lf-z-menu`), so Job Review, Live Motion and ABORT JOB are never covered by it.
   - It opens only when asked, as tutorials do (F-LEARN1). Its progress is derived from state; the
     skipped steps and a "job started" latch live in a session store and reset with **Start
     over**.
2. **Simple view.** Window → **Simple View** and Settings → General → **Simple view** switch one
   computer preference (`kerfdesk.simple-view.v1`, off by default, like display units). While it is
   on, the laser artwork inspector shows the process, Power, Speed, Passes and every notice it
   already shows, and in place of the process options, **Scan both ways**, **Air assist** and
   **More cut settings** it shows a short note with **Show all settings**, which turns the view off.
   - **Never hide a value that changes the burn.** The note lists, with its value, every setting
     the view hides that this process uses and that differs from what a new operation has
     (`LAYER_DEFAULTS`, or the documented meaning of an absent optional field), or that differs
     between the selected artworks. A switch's details are listed while that switch is on.
     `simple-view-hidden-values.ts` classifies every key of `LAYER_OPERATION_SETTING_KEYS`, and a
     test fails when a new key is not classified, so a setting cannot be hidden by omission. Where
     the process a setting serves was in doubt, it is listed for more processes.
   - The artwork **Power multiplier** is hidden only while every selected artwork is at 100%.
   - Simple view is presentation only. It changes no stored value, project file, recipe, Preview,
     Job Review, Pause, Abort, run control or G-code. A test holds the list of files that read it
     to the inspector, the menu, Settings and their tests.
   - CNC operation settings are unchanged in this first increment.

### Consequences

- A first job has a path the operator follows in the workspace, with the same gates and warnings
  as every other job.
- Simple view can make a burn-changing value less prominent, never invisible: it moves from a
  control to a line of text with its value until the operator asks for every setting.
- `SearchTarget` gains `connect`, `machine-setup` and `materials-tab`, so Ctrl+K and the guide
  reveal the same controls; the Artwork panel's Materials tab reveals in the Artwork panel.
- `recipeMatchesLayer` is exported from `material-library-actions.ts` for the material step.

### Open questions for the maintainer

- Whether a brand-new install should offer the guide, or turn Simple view on, by itself. Both
  stay off here: tutorials never open automatically (F-LEARN1), and an existing operator's panel
  must not change under them.
- Whether Simple view should also cover the CNC inspector and the Cut Settings dialog.
