# Code quality audit C2 — ledger

Plan: [AREAS.md](AREAS.md). Severity: P1 harms a job, loses work or exposes a secret (METHOD §3), or lets such a defect reach `main` unchecked. P2 is a real defect with limited harm. P3 is structural.

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| D1 | Merge-train review (64 PRs since C1) | origin/main @ 6ce535a26 (auditor and refuter). The coordinator re-read 623551b31, where none of the cited files changed. Node scripts on the real modules and the repo's Moshi and Ruida simulators; the refuter used its own stroke trace, a wall-clock Ruida simulator and a fake WebUSB device | [D1-merge-train-review.md](D1-merge-train-review.md) | 8 | 0 | 3 | 4 | 1 | 0 |
| **Total** | | | | **8** | **0** | **3** | **4** | **1** | **0** |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| D1-P1-1 | D1 | **A Moshiboard burns each image row's overscan run-up.** Every row cuts from its laser-off entry point, not from the first dark pixel. A default Image layer (5 mm overscan) on dark art at X 110–130 burns X 105–135: 5 mm of full-power burn outside the art on every row, alternating sides, with no warning. The only raster test uses overscan 0. | **READ** on main `623551b31`: `moshi-raster-plan.ts:116-124` pushes a laser-off step to `entryX`, then each run's end, so the first run's cut starts at `entryX`. Auditor and refuter **REPRO** (real `prepareOutput` → `emitPreparedMoshiJob`; the refuter traced the encoder's own calls). | routed to the Moshiboard session (local_d7499c71). Fix: a laser-off move from `entryX` to the first dark pixel's edge (both directions); a decoded test with overscan above 0 |
| D1-P1-2 (refuter) | D1 | **The Moshi raster ignores the layer's Dot width correction and every bidirectional scan offset** (the layer's and the device's speed table). Program bytes are identical with or without them, while the G-code route applies both. Sub-millimetre and off by default, but silently wrong position (METHOD §3 has no reach clause; precedent Z3-P1-2). | **READ** on main: `moshi-raster-plan.ts` reads only `group.bidirectional`; `grbl-strategy.ts:333-335` applies `dotWidthCorrectionMm` and the scan offset. Refuter **REPRO**. | routed to the Moshiboard session. Fix: apply both as `emit-raster-sweep.ts` does, or warn before Start when set |
| D1-P2-5 (refuter; coordinator: **P1**) | D1 | **A Moshi or Ruida network job has no always-reachable Abort.** `Ctrl+.` and the Live Motion bar read only the line-based laser store. The only Abort sits in a collapsed section of the Machine details popover, which unmounts on any outside click or Escape. This breaks non-negotiable 9, "reachable from any window state during a job". The coordinator rates it P1, as the 2026-07-13 handoff rated an unmounted Stop (T2). | **READ** on main: `use-job-shortcuts.ts:92-117` (`stopShortcutAction`) consults only `LaserSnapshot`. Refuter **REPRO**: a real capture-phase `Ctrl+.` during a running Moshi job writes no estop. | routed to the Moshiboard session, with D1-P2-1 and D1-P2-3 as one "machine work active" change |
| D1-P2-1 | D1 | **Moshi and Ruida network jobs show their compiled warnings only once the job is being sent.** These cover a run-up past the bed, grey burning as black, the vector speed clamp, the rotary dose and the `.rd` advisories. The canvas does outline objects past the bed and draw no-go zones before Start. After Start, the list sits in a collapsed section of a popover that closes on any outside click. | **READ** on main: `moshi-usb-store.ts:191-197` and `ruida-network-store.ts:188-194` set `advisories` in the same `set()` that starts sending. Auditor **REPRO** (Moshi). | routed to the Moshiboard session (cross-store change) |
| D1-P2-2 | D1 | **A Ruida Frame that ends before the first 400 ms status poll never counts, and Start is refused with no time limit.** Frames of 250 and 380 ms stay in `framing`. Abort plus a re-Frame from the start corner stays stuck too. A job shorter than the first poll stays `running`. | **READ** on main: `ruida-network-monitor.ts:55-69` counts idle reads only after `busySeen`, and the first poll is 400 ms after the last ACK, with no bound. Auditor and refuter **REPRO** (repo simulator; the refuter's busy bit follows the wall clock). | routed to the Moshiboard session; the Ruida session is not live. Fix: an immediate first read and a bounded "received the whole file and idle" rule; a fast-frame simulator script |
| D1-P2-3 | D1 | **Close, Update, project drop and Machine Setup save ignore a Moshi or Ruida job.** A Moshi job closes or updates at once, with no question and no estop, and a two-layer job loses its second layer. A Ruida Update is not refused; Electron's quit then aborts the job with Stop Process. Changing the profile mid-job unmounts the only Abort. | **READ** on main: `desktop-close-runtime.ts:31-44` builds the close snapshot from `useLaserStore` only; the same holds for `prepareForUpdate`, `use-machine-setup-save.ts:47-55` and the project-open guard. Auditor and refuter **REPRO** (Moshi). | routed to the Moshiboard session: one "machine work active" query that every machine store answers |
| D1-P2-4 | D1 | **A PostScript file with no bounding box (or a zero-height one) whose artwork is one horizontal or vertical line imports nothing.** The same happens for collinear rules and for thick strokes. | **READ** on main: `ps-svg.ts:14-35` (`paintedSvg`) writes a zero `height`/`width` and `viewBox`, so `parseSvg` finds no drawable geometry. Auditor and refuter **REPRO** (through `importPostscriptFile`). | routed to the EPS/AI session (local_de13cd2d). Fix: a minimum extent for a zero axis, counting stroke width |

### P3s (1)

- **D1-P3-1:** a Moshi Connect whose status read fails or stalls, or a WebUSB `selectConfiguration` failure, leaves the device open and claimed until the page closes. It goes to the Moshiboard session with D1-P1-1, since it touches the same files.

### Clean (merged since C1, reviewed)

The auditor's line review found these clean:
- #1694, #1711, #1715, #1732, #1735, #1736, #1733, #1714, #1716, #1717, #1719, #1708, #1731, #1734 and #1718.

The refuter then tried to break #1732, #1736, #1733, #1694 and #1711 with its own scenarios, and could not.

Design Studio (#1706, #1709, #1710, #1713) and #1692 were read only.

### Not verified

- Moshi and Ruida byte meanings against MeerK40t (its source is not on this PC).
- Real Ruida busy and idle timing; real Moshiboard timing.
- Browser runs (memory stayed under 2 GB for most of the run).
- Design Studio and #1692 in depth.

### For D2 (single choke points)

The Ruida `.rd` writer also ignores Dot width correction and the scan offset. That predates C1, so D2 should trace every route's raster settings.
