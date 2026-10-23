## ADR-630 Amendment 8 - grblHAL tool-table offsets make Work Z stale (2026-10-23)

**Status:** Accepted. Amends ADR-630 Amendment 6 and the Console's Work Z rule. Keeps PROJECT.md
non-negotiable 21 and ADR-565: nothing new refuses, and the completed Frame stays the only ordinary
Start gate. Fixes meta audit finding M4-P1-2, a gap in the fix for controller audit v4 E4-P2-1
(PR #1413). | **Date:** 2026-10-23

### Context

Amendment 6 made an opened program drop the probed Work Z record (`workZZeroEvidence`, bound to
`workZReferenceEpoch`) when a line changes a Z offset or the tool. It read each line with the
Console's rule (`commonConsoleStateEffect`), and that rule knew `G43.1`, `G49`, `M6` and `T` as tool
words, but not grblHAL's tool-table words.

grblHAL built with a tool table (the tool table plugin or an ATC; `N_TOOLS` is 0 by default) also
sets the tool length offset with:

- `G43 H<n>`, which loads tool n's offset. Without H it takes the block's T word or the current tool
  (grblHAL core `gcode.c` L1670-1690 and L2944-2968 at `4ec1ae44b`).
- `G43.2 H<n>`, which adds tool n's offset to the active one (same lines; H is required).
- `M61 Q<n>`, which makes tool n current at once (L4164-4185) and applies a pending `G43`
  (`gc_tool_changed`, L1002-1009).

A program end resets neither modal group 8 nor the H word (L5022-5026), and a soft reset keeps the
offset (`gc_init`, L787-793). A file with `G43 H1` and no `T` or `M6` left the store's Work Z
current, so the next CNC project Start skipped its Zero Z check and cut at the shifted depth. The
Console had the same gap: `G43 H1` typed there was a `machine-state` command, which voids the Frame
but not Work Z.

### Decision

1. **The tool words gain `G43`, `G43.2` and `M61`** (`TOOL_COMMAND_RE` in
   `src/core/controllers/console-state-effect.ts`, which cites the grblHAL lines). The Console and
   an opened program both read the rule, so both now clear `workZZeroEvidence`, bump
   `workZReferenceEpoch` and, in the Console, drop `wcoCache`, as for `G43.1`.
   - `G43` counts with or without H, because a bare `G43` applies the current tool's offset.
   - `G43.2` counts with or without H. Without H grblHAL refuses the line, and a refused line costs
     only a Zero Z check.
   - `G49` and `G43.1` were already tool words.
   - `G10 L0`, which reloads the current tool's offset, and the tool-table writes
     `G10 L1`/`L10`/`L11` were already Work Z changes under the `G10` rule (`coordinates-all`
     without axis words, `coordinates-z` with Z).
2. **Stock GRBL and FluidNC refuse these words.** The rule is shared with Marlin and Smoothieware
   too, and a refused or unknown word only costs a Zero Z check. Telling refused lines apart would
   need the controller's answer to each line, and the record is dropped before the first line is
   sent (Amendment 6, decision 1).
3. **Only the rule changes.** The words are spelled the way the controller parses them
   (`G043.0`, `G43.20` and `M061` included), and a word inside a comment is still ignored.
   `G43.3` and `G43.15` stay unknown words, as grblHAL refuses them.

### Not in this decision

- A Run review warning naming `G43`. The review still lists it among the words the Inspector does
  not interpret, and after a run the next CNC Start asks for Zero Z again.
- grblHAL's toolsetter `$TLR`/`$TPW` Console commands, which are not G-code words.

### Consequences

- After an opened program or a Console line with `G43`, `G43.2` or `M61`, the next CNC Frame asks
  for Zero Z again, and the CNC Start check applies.
- On stock GRBL a program with these words already stops with an error. The extra Zero Z check is
  the only change there.

### Verification

- `console-state-effect.test.ts` covers `G43 H1`, `G43H2`, a bare `G43`, `G043.0 H1`, `G43.2 H3`,
  `G43.20H3`, `M61 Q2` and `M061Q2`, alone and next to an XY `G92`. `G43.3`, `G43.15`, an `H` after
  an `X43`, `M62` and a commented `G43 H1` are not tool words.
- `external-program-controller-state.test.ts` reads `G43H1`, `G43 H2`, `G0G43Z5H1`, `G43`,
  `G43.2H3`, `M61Q2` and `G49` in a CAM-style program as voiding Work Z. A `G43H1` program's patch
  clears the evidence and keeps the known WCS.
- `console-command.test.ts`, `grblhal-console-command.test.ts` and `laser-store-console.test.ts`
  check the Console. The last one sends `G43 H1`, `G43.2 H2` and `M61 Q2` through the real store and
  sees Work Z cleared with the XY origin kept.
- With the old rule, all ten new classification and patch cases fail.
- No hardware was run, and no grblHAL build with a tool table was tested.
