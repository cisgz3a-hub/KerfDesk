# Rolling audit v11: the areas not audited lately

**Requested by** the maintainer on 2026-11-08 ("next loop"). They chose, from four options, "Areas not audited lately": a round on the parts of KerfDesk that the last rounds (v5–v10, the performance audit S1 and the new-user audit U1) did not reach.

**Scope.** Main `5f09e1110` (unchanged since 2026-11-05). Each area was last audited in rolling v2 (2026-10-21) or v3/v5 (2026-10-27). Since then several hundred PRs have merged, and none of these areas has been looked at as a whole. Finding IDs are `W<area>-P<n>-<k>`.

**PRs stay open.** The repository is private and its Actions are blocked (2026-11-06). So fix PRs from this round are opened, then left unmerged until the maintainer restores CI.

**Security.** For any finding at a trust boundary (licence tokens, the phone/MCP service, Electron IPC, the updater, file parsers), the committed report gives only the class, the area and the severity until the fix merges. The repro and exploit details stay in the coordinator's scratchpad. The rule is "Security findings are redacted until fixed".

## Method

[rolling-v2 METHOD.md](../2026-10-21-rolling-v2/METHOD.md) applies in full:
- §3, with its clarifications.
- §4: pinned citations, and ADR quotes only from `docs/decisions` / `DECISIONS.md`.

Each area gets an auditor and then a fresh refuter. The coordinator re-verifies every P1/P2 in main's code.

These are full-area audits, not fix verification. Use lenses L1–L7 from METHOD §2 as they apply, and L9 (entry-point parity, rolling v4). Use L8 (change risk, rolling v3) for the PRs merged in the area since its last audit.

## Areas (run order)

| # | Area id | Last audited | What it covers | Lenses |
|---|---|---|---|---|
| W1 | `licensing-pro-gating` | v2 02 (2026-10-21) | Licence activation, tokens, offline grace, Free/Pro gating at every entry point (menus, Ctrl+K, lessons, phone/MCP), the Free stub exports | L1, L5, L9, L6 |
| W2 | `remote-mcp-phone` | v5 J3/J4 (2026-10-27) | Phone pairing, the remote-control Worker and its owed redeploy, MCP tools, the guards on remote job control (Start, Abort, Frame), artwork sharing | L5, L9, L6, L4 |
| W3 | `electron-main-updater` | v2 04, v3 G7/H10 | Electron main process, preload/IPC surface, file associations, the updater and installers, crash handling, window lifecycle | L5, L6, L2 |
| W4 | `camera` | v5 J5; #1546 (2026-11-02) left 7 architecture items open | Camera setup and calibration, RTSP login probe, overlay placement accuracy, camera target engrave, job watch and timelapse | L2, L3, L6, L8 |
| W5 | `import-export-formats` | v2 13/14/21, v5 J6 | SVG/DXF/PDF/AI/EPS import, LightBurn `.lbrn`/material libraries, project `.lf2` round-trip, G-code and image export | L4, L5, L3 |
| W6 | `relief-generators` | v2 16/25 | Relief, design generators (boxes, gears, QR and similar), their output against the canvas | L3, L4, L1 |
| W7 | `gcode-viewers-inspector` | v2 26 | G-code Inspector and Run, the viewer, Start from line, simulation preview against the burn | L3, L9, L6 |
| W8 | `ai-features` | v2 28 | AI-assisted features: prompts, data sent off-device, failure paths, gating | L5, L6, L2 |
| W9 | `platform-web-docs` | v2 19/24 | The browser build (no file pickers, storage limits), the website, docs and in-app help drift against the code | L1, L2, L9 |

W1 runs first and W2 second: both are trust boundaries where a P1 harms users beyond one job.

## Overlap with other work

- Rolling v10 (PR #1613) and its seven fix sessions are still open, so treat their findings as KNOWN:
  - V1-P1-1: archive re-check
  - V2-P2-2: stale CNC laser
  - V3: reconnect and origin restore
  - the white knock-out
  - V7-P1-1: Recover unsaved work
  - V7-P2-3: Cut last
  - V8: held Enter
- The P3 sweeps #1592, #1596, #1597, #1601 and #1605–#1612 are also KNOWN.
- Do not audit those PRs' diffs.

## Batching

- One audit agent at a time; the PC is low on memory and runs the fix sessions.
- A refuter goes before the next auditor.
- Repros run on a scratchpad export of main.
  - Browser runs use an export whose Vite config aliases `fflate` to the main checkout's pnpm store.
  - Never run `pnpm`, because it starts an install.
- Memory gates: Vitest needs 1.5 GB available or more. A browser needs 2 GB or more, headless, with one worker and one spec at a time.
- Never operate hardware. Never download or install software. Never launch the installed KerfDesk.
- Never send real data to external services. For W2, W3 and W8, use local stubs; never call the live Worker, the updater feed or an AI provider with real credentials.

**Status:** done 2026-11-09. All nine areas ledgered: P1 7 / P2 7 / P3 18 (34 raised, 2 refuted); W3 fixed by #1628, the rest owned by fix cards. See [LEDGER.md](LEDGER.md#round-result-2026-11-09).
