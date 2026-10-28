## ADR-584 Amendment 1 - A remote Undo or Redo that changes the machine says so (2026-10-28)

**Status:** Accepted; software-verified through tests that drive the real remote adapter against
the desktop store, the MCP server and the built phone app. Not tested on a real phone, against the
production relay, or on a machine. | **Date:** 2026-10-28

Extends ADR-584 (and ADR-568, which added remote `undo` and `redo`) to machine steps, and applies
[ADR-440 Amendment 6](ADR-440-amendment-6-keep-current-machine-is-an-undo-step.md) Decision 2 to
the remote caller. Follows rolling audit v5 finding J7-P2-1 (P2), which an independent refuter
confirmed and the coordinator re-verified in main's code. Changes nothing in Frame, Start, the job
lock or output.

### Context

The phone and the MCP tools `undo` and `redo` run the PC's own Undo and Redo on the shared history.
ADR-440 Amendment 6 made **Keep current machine** an Undo step, so that undoing it brings back the
opened file's machine together with the PC's notice, "so the operator sees the question again".
The remote receipt was only `{changedArtworkIds, selection, history}`, and nothing in the remote,
phone or MCP code reads the notice (`projectBedReconciliation`).

In the audit's repro a file saved before an origin and bed correction was opened and the current
machine kept: rear-right, 400 × 410 mm, with a clamp zone. A phone Undo, with no phone edits left
to undo, returned `{"changedArtworkIds":[], …}`. The machine went back to front-left, 400 × 400 mm,
with no zones. The first burn line moved from Y10 to Y390, and the clamp collisions dropped from 5
to 0. The notice came back on the PC only, a screen ADR-569's phone-only workflow (import, Frame,
Job Review, Start) never shows. A remote Undo or Redo of any other machine step, such as a Machine
Setup save, was just as silent.

Two answers were weighed:

- **Refuse a remote Undo or Redo across a machine step.** Remote clients have no machine setup
  controls, so such a step was always made on the PC. But the remote protocol has a small, fixed
  set of public error codes, and each client turns a code into its own fixed text. The MCP server
  (`backend.ts`), the relay and the phone (`transport.ts`) all do this; none forwards the PC's
  message. A refusal with an existing code would reach an MCP agent as "The desktop workspace is not
  available. Open KerfDesk and try again.". That text is wrong. A clear one needs a new public code
  in the desktop bridge, the MCP server, the relay Worker and the phone. A refusal would also leave
  the remote history stuck at that step, with every older remote edit out of reach.
- **Run the step and carry the PC's notice in the receipt.** ADR-584 runs each remote tool through
  the same desktop store action as the matching desktop control. Since ADR-125 Amendment 2 a remote
  receipt also carries what the PC showed, in `notices`. ADR-569 Amendment 3 put those notices on
  the phone for its phone-only workflow.

The second keeps that remote parity, and it is the one taken.

### Decision

1. **A remote Undo or Redo still runs the PC's step, machine steps included.** The machine, the
   PC's notice and the Undo and Redo lists end exactly as after a desktop Undo or Redo.
2. **A step that changes the machine setup adds a notice to the receipt.** It counts as such a step
   when it changes the Laser/CNC kind, the CNC machine, or any machine setting
   (`sameMachineSetup`, `job-machine-lock.ts`). The job lock compares only the motion fields; this
   check compares every setting. The receipt gains `notices`, one `warning`:
   - When the step brings back the opened-machine notice, the warning says that the opened file's
     machine is back and that the PC asks again. It says that Frame and Start use the file's machine
     until the question is answered on the PC. Then it quotes the PC banner's own words. The banner
     and the receipt share one builder, `openedMachineNoticeWords`.
   - Otherwise it names the machine Frame and Start now use (its name, Laser or CNC, and the bed
     size). It also says when the step closed the PC's question, and asks for a check on the PC
     before Frame.
   - A message that would carry a path, URL or token falls back to the same words without names
     (`safeLabel`).
   - A step that leaves the machine setup alone adds no `notices`, as before.
3. **MCP passes it on.** The `undo` and `redo` output schemas keep `notices`. Their descriptions say
   that Undo shares the PC history, can undo a machine choice made there, and that every warning goes
   to the user.
4. **The phone shows it.** The Undo and Redo buttons and Ctrl+Z (Shift+Ctrl+Z) show each warning or
   error notice of the receipt as a phone toast. It stays 15 seconds, long enough to read before
   the next Frame. A receipt without notices shows nothing new.
5. **Not changed:** no remote Undo or Redo is refused for this. The PC banner's words and buttons
   stay as they are. A remote Undo that the job lock refuses still returns a plain receipt, rolling
   audit v5 H9-P3-1, which stays open.

### Consequences

- An MCP agent and a phone operator learn that an Undo or Redo changed the machine their Frame and
  Start will use, and how to put it right on the PC.
- **Relay deploy dependency.** The relay Worker re-parses desktop results with its bundled output
  schemas, so until it is redeployed it strips `notices` from `undo` and `redo` receipts, as it did
  for imports (ADR-125 Amendment 3, J3-P3-2). The local MCP server uses the desktop's own schemas and
  is not affected. The Worker deploy is the owner's step; this change adds no deploy.
- The phone bundle (`public/app/`) and the MCP App (`electron/mcp/workspace-app-ui.ts`) are rebuilt
  from source by `build-app.mjs`.
- The phone's notice is a toast, not a lasting banner. A phone that never Undoes still learns
  nothing of a notice the PC left open. Showing an open machine notice in the phone's workspace and
  Job Review is a recorded follow-up.

### Verification

- `src/ui/remote-control/history-machine-notice.test.tsx` uses the real store, persistence hook and
  banner, the file round-tripped through Save and Open, and remote writes through the real adapter.
  - A remote Undo of Keep current machine brings back the file's machine and the PC banner, and the
    burn line changes, as on the desktop. The receipt's one warning names the bed, origin and no-go
    zones in the banner's words.
  - A remote Redo returns 400 × 410 mm with no notice, and the receipt says the PC question closed.
  - An Undo of a remote rectangle carries no `notices`.
  - `sameMachineSetup` treats a rebuilt machine with the same values as the same, and a changed
    S max (`$30`) as different.
  - The first two cases fail with the receipt change reverted.
- `electron/mcp/server.test.ts`: `undo` and `redo` results keep `notices` through the output schema.
- `services/remote-control/test/history-notice-ui.test.mjs` (built phone app, synthetic PC): a
  receipt notice after Undo is shown as a warning toast; a plain Undo shows none.
- `src/ui/app/ProjectBedReconciliationBanner.test.tsx`, `opened-machine-kept.test.tsx` and
  `opened-machine-older-bed-and-origin.test.tsx` still pass with the banner's words moved.
- Code and test evidence only. No machine was moved.
