## ADR-703 Amendment 1 - The K40 route joins the shared choke points (2026-11-12)

**Status:** Accepted. Amends ADR-703 (Lihuiyu `.egv` export and USB link). Follows ADR-705
Amendments 1, 2, 4 and 6, which did the same for the Moshiboard and Ruida links. Keeps
PROJECT.md non-negotiables 9 and 21 and ADR-565 (frame-first Start). Fixes code quality audit C2
D6-P1-1, D6-P1-2, D6-P1-3, D6-P2-1, D6-P2-2, D6-P2-3, D6-P3-4 and D6-P3-6. **Simulator-tested
only.** | **Date:** 2026-11-12

### Context

The K40 (Lihuiyu) route was built beside the Moshi and Ruida links, and it missed the shared
pieces they had been moved onto:

- **Scope.** The K40 USB job compiled the whole canvas. "Selected artwork only" and "Anchor from
  selected artwork" were ignored, so Start could burn artwork the operator had left out.
- **Rotary.** A Y-port rotary scales Y by k, but the K40 wrote one speed per layer. A stroke round
  the part moved the surface k times too fast or too slow.
- **Fill and Image.** Fill and Image rows were planned locally. They ignored the bidirectional
  scan offset (the layer's value and the machine's speed table), and Image rows ignored Dot width
  correction and the overscan runway policy.
- **Warnings and variables.** Neither Save `.egv` nor the K40 job carried the job warnings Save
  G-code shows ("will NOT be cut", a kerf side assumed, cut order). A finished K40 job never ran
  the "After completed job" variable advance.
- **Guards.** Autosave and the in-app dialogs' "refuse during a job" read only the laser store,
  so a link job did not count.
- **Guided first job.** The guide read only the serial connection, Frame and stream. It never
  moved on for a K40, Moshiboard or Ruida, and "Show me" pointed at the serial Connect, which a
  link profile leaves disabled.
- **Comments.** Three file headers said the K40 was already covered when it was not.

### Decision

1. **The K40 job takes the shared link request.** `prepareLihuiyuUsbJob(request, head)` takes
   the `LinkJobRequest` that the Moshi and Ruida jobs take, so it uses the same placement, output
   scope and variable advance. The panel builds it with `currentLinkJobRequest()`. The store runs
   `job.completed` once the board reports the job finished, never after a Frame.
2. **Fill and Image use the G-code planners.**
   - Scanline Fill sweeps come from `planFillSweeps` and `expandFillHatchWithRunways`.
   - Image rows come from `planRasterRowSweeps`, with overscan and Dot width correction.
   - Every row moves by `rasterRowShiftX` with the layer's scan offset, or else
     `offsetForSpeed` from the machine's table (ADR-052 Amendment 2).
   - Each sweep stays in program mode: laser-off along the runway, burning across the ink,
     laser-off across gaps and the exit runway.
3. **A Y-port rotary sets each stroke's speed for the surface.**
   - `emitPreparedEgvFile` passes `rotaryFeedMatchFor` to the encoder.
   - Each burn runs at the whole mm/s that `surfaceMatchedFeed` gives, as G-code and the
     Moshiboard match it (ADR-127 Amendment 2).
   - A new speed code re-enters program mode, which stops the head briefly. The export counts
     these stops per layer and says so as an advisory.
   - Rotary Setup on a K40 or Moshiboard shows `USB_LINK_ROTARY_NOTE`: speeds are whole mm/s, a
     speed change stops the head, use the Y port, and the setup is not checked on a machine.
4. **Job warnings on `.egv`.** `emitPreparedEgvWithJobWarnings` (`ui/laser/egv-job-warnings.ts`)
   is the `.egv` twin of `rd-job-warnings.ts`. Save `.egv` and the K40 job both encode through it,
   so both carry `detectMachineJobWarnings` beside the export's own advisories.
5. **Link jobs count as jobs.**
   - Autosave's `isStreaming` includes `activeLinkMachineWork()`.
   - The in-app dialogs' `refuseDuringJob` reads `anyMachineJobActive()`.
6. **The guide reads link state.**
   - Each link store reports `{connected, framed}` to the boot-side registry with
     `reportLinkMachineStatus`.
   - The guide's connected and Frame-ready signals add `anyLinkConnected` and `anyLinkFramed`.
   - Its job latch also fires when link work is `running`.
   - The three link panels' Connect buttons carry `data-search-target="connect"`.
   - On a profile whose driver uses a USB or network link, "Show me" opens the closed Machine
     details popover (`reveal-control.ts`) and focuses that Connect. Every reveal now prefers a
     visible, enabled copy of its control.

### Evidence

- `lhy-route-planners.test.ts` reads the encoded stream back with the simulator's decoder:
  - Fill sweeps and Image rows move by half the layer's scan offset, and the same with the
    machine's table;
  - Image rows run the overscan laser-off and burn only dark pixels;
  - Dot width shortens each burn;
  - a k = 2 rotary rectangle runs two speeds with three counted stops;
  - k = 1 keeps one speed.
- `link-job-routes.test.ts`: the K40 job burns only the selected square, and carries the G-code
  job warnings and the request's completion.
- `lihuiyu-usb-store.test.ts`: the completion runs once after the simulated job, not after the
  Frame, and the registry sees the link connected and framed.
- `use-autosave-during-job.test.tsx`: a heavy project waits during a K40 job and is written after
  it.
- `app-dialogs.test.ts`: a "refuse during a job" confirm fails closed during a link job.
- `use-first-job-signals.link.test.tsx`: link connected, Frame and running job move the guide; a
  link Frame is not a started job.
- `reveal-control.test.ts`: on a K40 profile "Show me" opens Machine details and lands on the
  enabled link Connect; on a serial profile it leaves the popover shut.
- `RotarySetupHost.ruida-note.test.tsx`: the K40 and Moshiboard note shows.

### Consequences

- The K40 burns what Save, G-code Start, the Moshiboard and the Ruida burn for the same canvas,
  scope and layer settings.
- A K40 rotary job may stop briefly at each change of stroke direction. That is how this board
  changes speed, and the export says how often it happens.
- Hardware qualification is still owed, now including the rotary speed match and the scan offset
  on a real K40.
