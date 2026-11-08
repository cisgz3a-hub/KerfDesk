# Pro loop audit v3: the controller side against a simulated GRBL

**Requested by** the maintainer on 2026-11-08 after rounds v1 (by sector) and v2 (by tool). Method
as [v1](../2026-11-08-pro-loop-v1/AREAS.md). The judge is the repository's own GRBL simulator
(`src/__fixtures__/controllers/grbl-sim-*.ts`), whose buffer sizes, line endings and planner are pinned
to gnea/grbl and grblHAL source, driven through the real streaming, pause, abort and recovery code.

## Areas

| # | Area | What is checked | Status |
|---|---|---|---|
| C1 | Simulator fidelity | RX ring, line endings, planner, jog cancel: do the simulator's own pins still hold on main | done — 44 tests pass |
| C2 | Blocked window during a burn (rolling v6 K1, ADR-676) | the beam never stays lit when the window transport stalls; worker-owned ports keep refilling | done — 18 cases pass locally in 91 s. That is near CI's limit and explains its three timeouts (#1513, #1520, #1522); the suite needs splitting, not loosening |
| C3 | Char-counted window | bytes in flight never exceed `rxBufferBytes`, terminators counted | [done](C3-char-counted-window.md) — clean |
| C4 | Pause, resume, abort | `!` / `~` / soft reset leave the beam off and the position known | next |
| C5 | Alarm and reconnect recovery | resume offers the right line; no re-burn of finished rows | next |
| C6 | Frame then Start | Frame's envelope equals the program's motion bounds on the simulator | next |

Every fix gets its own PR, as in v1 and v2.
