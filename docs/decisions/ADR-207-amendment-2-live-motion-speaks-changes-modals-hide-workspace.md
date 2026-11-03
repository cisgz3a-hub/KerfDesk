## ADR-207 Amendment 2 - Live Motion speaks changes, not counts; a modal hides the workspace from assistive technology but never the bar (2026-11-03)

**Status:** Accepted on 2026-11-03 |
**Amends:** ADR-207 (the live-motion bar; its 2026-09-19 amendment is the first) and the dialog
shell of ADR-047 (`use-dialog-a11y.ts`). It changes no G-code, no Start guard and no controller
command: Job Review stays advisory (ADR-228), and ABORT JOB and `Ctrl+.` act exactly as before.

### Context

UX audit U7 (`docs/audits/2026-11-03-ux-u1/U7-accessibility-small-screens.md`, refuted the same
day) found three accessibility P2s:

- **U7-P2-1.** The bar's status line was a polite live region, and its line count republishes up to
  every 120 ms (ADR-333). With the status bar's elapsed tick (`role="status"`, every second) a
  screen reader queued 48-55 announcements in 10 s of a job, burying every toast.
- **U7-P2-2.** The first-visit welcome dialog mounts while `#app-root` is still `inert` behind the
  splash, so its focus call did nothing. Tab walked 57 controls behind the backdrop, Enter on the
  hidden Open… started a file pick, and Escape did nothing. Chromium also keeps the whole workspace
  in its accessibility tree under the kit's `aria-modal="true"`.
- **U7-P2-3.** The dialog Tab trap counted no `<summary>`, so Job Review's warning rows, and the
  advice inside them, could not be reached by keyboard.

The refuter also showed that it is Chromium ignoring `aria-modal` that keeps ABORT JOB reachable
for a screen reader while a dialog is open.

### Decision

1. **The bar is not a live region.** One always-mounted polite region (`LiveMotionAnnouncer.tsx`)
   speaks only changes of the bar's heading (job running, paused, resumed, a hold and why, machine
   finishing, framing, laser on) and, while the job runs, its progress at each 10 %. When a job
   ends it says aborted, finished, or that the controller disconnected or reported an error, read
   from the streamer's last status or else the run record (`liveCanvasRun.lifecycle`). An assertive region says
   when an alarm stops what the bar showed. The status bar's run line is no longer `role="status"`
   while a run is shown; its idle cautions still are.
2. **A modal hides what is behind it from assistive technology** (`hide-outside-modal.ts`):
   `aria-hidden="true"` on everything beside the path from the topmost modal to `<body>`, counted
   per element so stacked modals compose. It is `aria-hidden`, not `inert`: the backdrop already
   stops the pointer, and the Live Motion bar must keep working under a dialog.
3. **Never hidden:** anything marked `data-modal-reachable` (the Live Motion bar and its
   announcer), any `role="alert"` and any `aria-live="assertive"` region, with the path down to
   them. An alert that mounts while a dialog is open is re-exposed at once.
4. **A dialog that mounts inside an inert tree takes focus when the tree is released**, unless
   something else has taken it. Tab and Escape pressed with focus on `<body>` reach the topmost
   dialog: Tab enters it at its edge.
5. **The Tab cycle counts each `<details>`' own `<summary>`**, except inside a closed `<details>`.
   Initial focus still skips summaries.
6. **ABORT JOB names its shortcut**: `aria-keyshortcuts` (`Control+.`, `Meta+.` on Apple) and
   "Shortcut: Ctrl+., also from inside a dialog" in its tooltip. `Ctrl+.` stays a window
   capture-phase listener (`use-job-shortcuts.ts`), so it aborts from inside any dialog.
7. **Small P3s.** Pause → Pausing… → Resume flips in one button marked `aria-disabled`, so it keeps
   focus. When a job's bar appears with focus on `<body>` (Start job disables itself and Job Review
   closes), focus moves to the bar's primary action. Copper focus rings use `--lf-focus-accent`,
   which is `#e39a63` in dark (6.08:1 on bg-0/bg-2, against 2.79:1 for `--lf-accent`).

### Consequences

- A Testing Library or Playwright role query for a workspace control while a modal is open now
  finds nothing unless it asks for hidden elements; that is what a screen reader sees.
- Not changed here: focus after Frame job and Set origin here (U7-P3-1's other half), the bar
  covering dialog footers at laptop heights (U7-P3-2), and the other U7 P3s.
- Evidence: `use-dialog-a11y.u7.test.tsx` and `LiveMotionAnnouncer.test.tsx` (over a 100-line job
  acknowledged one line every 100 ms, at most 12 polite changes: nine 10 % steps, machine finishing
  and finished). Re-run of the audit's Chromium REPRO on a production build at 1366 × 768, with the
  simulated controller acknowledging every 300 ms: 7 live-region changes in 10 s of a job, where the
  refuter measured 48. The welcome dialog had focus after the splash, 12 Tabs stayed inside it,
  Escape closed it, and Chromium's tree dropped from 419 to 91 unignored nodes, with no Open….
  Job Review's Tab walked all six summaries. With Keyboard Shortcuts open during the job, ABORT JOB
  and Pause stayed unignored, and `Ctrl+.` sent `0x18`. No real screen reader was run.
