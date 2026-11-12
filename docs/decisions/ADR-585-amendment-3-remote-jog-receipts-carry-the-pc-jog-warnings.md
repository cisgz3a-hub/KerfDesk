## ADR-585 Amendment 3 - A remote jog's receipt carries the PC's jog warnings (2026-11-11)

**Status:** Accepted (rolling audit v4 finding H8-P2-2, its secondary point; ADR-375 Amendment 8
fixed the travel clamp and left this half out; the maintainer's standing instruction to fix
confirmed audit findings). Amends ADR-585's `jog_machine` and hold-to-jog receipts. Leaves
ADR-232's warn-only policy unchanged. | **Date:** 2026-11-11

### Context

Every direct jog runs `warnJogMotionPolicy` (`src/ui/state/laser-jog-warnings.ts`). It compares
the jog path with the configured machine bounds and the enabled no-go zones. A finding is
published as a PC toast and a console log line, and the jog is still sent. Configured bounds and
no-go zones are operator guidance, and the controller's own limits stay the authority (rule 7,
ADR-232, DEV-04).

A remote jog runs the same `jog()` action, so the PC showed the warning. The operator who pressed
the jog on the phone, or the agent that called `jog_machine`, did not see it.
`executeJog` finished with a bare `completed`. `executeHold` finished with "Reached the hold travel
limit." or "Stopped.". So a phone jog past the configured bed edge, or through a clamp marked as a
no-go zone, reported only success to the one person watching the machine.

### Decision

1. **The jog reports what it warned.** `warnJogMotionPolicy` returns the warnings it published, in
   order, as well as publishing them. `jog()` passes them to its execution owner through a new
   optional `MachineExecutionOwner.onMotionWarnings`. The PC's own jogs have no owner, and they
   publish exactly as before. The remote reads the jog's own result. It never reads the toast
   store.
2. **The receipt repeats them word for word.** A completed remote operation's `message` is the
   outcome text, if any, followed by each warning, joined by spaces (`completeRemoteJog` in
   `machine-operation-state.ts`):
   - `jog_machine`: the warnings alone. A clean jog keeps a bare `completed` with no message.
   - `jog_hold_start`: "Reached the hold travel limit." or "Stopped.", then the warnings. A hold
     warns about the target it aimed at. If the phone released early, the head stopped short of
     that target, as it does on the PC when the PC's own hold is released.
3. **They stay warnings.** Nothing new is refused. The jog is sent unchanged, the receipt is
   `completed` and `committed: true`, and the PC still shows its toast and log line. The phone
   page already shows a finished operation's `message`.
4. **Projected as policy text.** The warnings are fixed desktop text with coordinates and a no-go
   zone's name. A no-go zone's name is device configuration, not artwork. A receipt that carries
   them sets `policyMessage`, so it is bounded by `safeLabel` at 2048 characters, as in
   Amendment 2, and does not go through the artwork-label filter. That filter would replace the
   whole receipt if a layer happened to share a word with the zone's name, and it caps text at
   512 characters. The flag is set only on completion. An earlier failure keeps the ordinary
   projection.
5. **MCP.** `jog_machine`'s description tells agents that a completed operation's message carries
   any bounds or no-go warning, and to relay it to the user word for word. The input and output
   schemas do not change, because `message` already exists on every operation.

### Consequences

- A phone or MCP operator learns of a jog past the configured bounds, or across a no-go zone, from
  the same text as the operator at the PC.
- The receipt is only as current as the PC's check. When the position is unresolved, the receipt
  says so, with the same "cannot compare" text the PC shows. A homed controller with no verified
  native frame is not compared on either side (audit jog-home-origin-3).
- No Worker redeploy is needed. The phone page and the Worker's schemas are unchanged. Only the
  desktop MCP tool description gains a sentence.
- `src/ui/remote-control/machine-jog-warnings.test.ts` drives the real remote `jog_machine` and
  `jog_hold_start` through the real GRBL store on a fake serial line. It then replays the same
  vector through the PC's own `jog()` on the same reported position, and checks that the texts are
  identical. Writing that test caught a short-circuit: `owner?.onMotionWarnings?.(warn())` would
  have skipped the PC's own warning on every PC jog.
