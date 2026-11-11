## ADR-705 Amendment 3 - Link jobs count as machine work everywhere (2026-11-11)

**Status:** Accepted. Amends ADR-705 (Moshiboard USB) and ADR-697 (Ruida over UDP) decision 1.
Keeps PROJECT.md non-negotiable 9: the software Abort is reachable from any window state during a
job. Fixes code quality audit C2 D1-P2-5, D1-P2-3 and D1-P2-1. **Simulator-tested only.** |
**Date:** 2026-11-11

### Context

The Moshi and Ruida network stores are deliberately separate from the line-based laser store,
and they load lazily so neither joins the boot bundle. Every always-mounted guard read only the
laser store:

- `Ctrl+.` and the Live Motion bar;
- the desktop close and Update handoff, and the Windows session-end report;
- project replacement (drop, restore, the job-aware dialogs);
- Machine Setup Save.

So during a Moshi or Ruida job, `Ctrl+.` sent nothing. The only Abort sat in a collapsed section
of the Machine details popover, which unmounts on any outside click. Closing the app neither
stopped the job nor waited for it, and Update did not wait. A profile change unmounted the only
Abort. The compiled job's warnings appeared only once sending began.

### Decision

1. **A boot-side registry.** `ui/state/link-machine-work.ts` holds each link's active work: its
   controller name, activity (framing, running, homing, paused or stopping), the job's warnings,
   and the link's own stop (the Moshi estop, the Ruida Stop Process). The two link stores report
   into it on every phase change. The guards read only the registry, so the link stores stay
   lazy.
2. **Abort is always reachable.** `Ctrl+.` sends the link's stop when no laser-store action
   applies. `LinkMachineWorkBar` is mounted beside the Live Motion bar and stays reachable behind
   modals. It shows ABORT JOB, or ABORT MOTION for a Frame or Home, with the job's warnings, and
   sits above the laser bar when both show.
3. **Every "is a job running" guard sees link work.** `anyMachineJobActive()` (laser job or link
   work) gates project replacement, the job-aware dialogs, Restore, and Machine Setup Save, which
   would otherwise unmount the Abort. The close snapshot counts link work as active. Close starts
   the link stops at once, alongside any laser stop, and closes only when the links are idle.
   Update waits. The session-end report includes link work.
4. **Warnings from the Frame on.** Both stores show the compiled job's warnings from its Frame,
   keep them while idle before Start, and show them in the bar during the job. They remain
   warnings, never refusals.

### Evidence

- `link-machine-work.test.ts`: a running Moshi job on the simulator is reported. The real
  capture-phase `Ctrl+.` writes the estop and returns the store to idle. `jobAwareConfirm`
  refuses while the job runs. A Frame is reported with its warnings, and they stay in the store
  after it.
- `LinkMachineWorkBar.test.tsx` covers the bar's absence, its text and warnings, that it stays
  reachable behind a modal, and that ABORT JOB runs the link's stop.
- `desktop-close-link-work.test.ts`: Update is refused with no stop sent; close sends the link
  stop and becomes ready once the link is idle. `desktop-close-runtime.test.ts` still passes:
  the laser stop is initiated synchronously.
