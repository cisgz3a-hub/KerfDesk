## ADR-703 Amendment 2 - K40 dose, row grid and warnings from the Frame (2026-11-12)

**Status:** Accepted. Amends ADR-703 Amendment 1. Fixes C2 verification E2-P1-1, E2-P1-2,
E2-P2-1, E2-P2-2, E2-P2-3, E2-P3-1, E2-P3-3 and E2-P3-4 (`docs/audits/2026-11-12-c2-verify/`).
Keeps PROJECT.md non-negotiables 9 and 21. **Simulator-tested only.** | **Date:** 2026-11-12

### Context

The C2 verification (E2) checked the K40 route after Amendment 1 and found gaps the other link
routes had already closed:

- **Rotary dose (E2-P1-1).** On a Y-port rotary each burn ran at whole mm/s, a Moshiboard
  limit the K40's speed code does not have. Strokes round an Ø80 glass on the Creality chuck
  burned at 32-80 % of the set dose between 120 and 600 mm/min, and nothing said so.
- **Slowest speed (E2-P1-2).** The speed code's value bottoms out at 0. On an M2 or M3 with
  suffix C that is 0.39 mm/s (23.5 mm/min), so a slower layer ran at 23.5 mm/min without a
  word. At 6, 12 and 20 mm/min that is 26, 51 and 85 % of the dose.
- **Warnings at Frame (E2-P2-1).** The K40 panel showed the job's warnings only once Start was
  sending, which #1753 had fixed for Moshi and Ruida.
- **Row grid (E2-P2-2).** Fill and Image rows on a Y-port rotary land on whole 1/1000 in steps.
  On an Ø80 glass, 100 rows become 63. The Moshiboard job warns about this on the same grid;
  the K40 did not.
- **Tabs and air (E2-P2-2, E2-P3-3).** An M2's knob note did not name burned tabs, and it
  listed a 100 % layer as "below 100 %" because of its tab group. Neither board says it
  cannot switch air.
- **Abort (E2-P3-1).** Ctrl+. and ABORT MOTION did nothing while the K40 homed or jogged.
- **Repeats and comments (E2-P3-3, E2-P3-4).** The `.egv` preflight repeated identical lines,
  and the panel keys its list by the text. Three header comments still named two links.

### Decision

1. **Rotary speed classes, not whole mm/s.**
   - `lhy-burn-speed.ts` sets each rotary burn to the surface-matched speed in classes 5 %
     apart. The classes are counted from the layer speed, so strokes along X and every image
     row keep the layer speed exactly.
   - The Ruida `.rd` route groups its rotary speeds the same way (ADR-127 Amendment 5).
   - Every burn stays within 2.5 % of its dose.
   - Speeds are grouped rather than sent exactly because each new speed code re-enters program
     mode, which stops the head. Exact speeds would stop the head at nearly every segment of a
     curve.
   - The encoder reports each layer's dose range, and the `.egv` and USB advisories name it when
     it leaves 95-105 %, the band the Moshiboard and Ruida notes use.
2. **The board's slowest speed is named, not refused.**
   - `lhySlowestMmPerSec` is the speed whose code value is 0.
   - Each burn runs no slower than that. A layer or rotary stroke below it gets a note naming
     the speed it runs at and its dose.
   - This follows the Moshiboard precedent (ADR-705 Amendment 5): a note, with the bytes
     unchanged.
   - Rotary Setup's K40 note says "in steps 5 % apart" and "nothing runs slower than 23.5
     mm/min". The Moshiboard keeps its own whole-mm/s note.
3. **Warnings show from the Frame on.** The K40 store sets the job's advisories when the Frame
   starts and keeps them after it finishes, as `moshi-usb-store` and `ruida-network-store` do.
4. **The K40 row check.** `emitPreparedEgvWithJobWarnings` runs `detectRotaryRowGridWarnings`
   on `K40_ROW_GRID` (1/1000 in), so Save `.egv` and the K40 USB job both carry it.
5. **Power the board cannot set.**
   - Moshi's tab, mixed-power and air notes move to `core/output/unexpressed-power-notes.ts`,
     with the wording for each board passed in. Moshi's text is unchanged.
   - An M2 now names burned tabs, and its knob note no longer counts a tab group as its layer.
   - Both K40 boards say they cannot switch air.
   - An M3 with PWM sets each group's power, so it gets no tab note.
6. **Abort reaches Home and Jog.** The K40 Abort resets the board during homing and jogging
   too. The interrupted Home or Jog leaves the result to the Abort, and the head is then unknown.
7. **Each finding once.** `withoutRepeatedIssues` (`core/preflight`) replaces `emit-rd.ts`'s
   private copy and de-duplicates the `.egv` advisories. The K40 job lists each line once.
8. **Comments.** The headers of `link-job-request.ts`, `LinkMachineWorkBar.tsx` and
   `link-machine-work.ts` name the K40.

Not done: E2-P3-2, a type-level contract every link store must meet (registry, job request,
warnings). It changes the shape of every link store, including the open JCZ galvo work
(#1725), so it is left for its own change.

### Evidence

- `lhy-burn-speed.test.ts`:
  - the slowest speed is 23.49 mm/min, and slower speeds set the same period;
  - a 6 mm/min layer reports 26 % and says so;
  - an ordinary speed says nothing;
  - on an Ø80 glass at 300, 600 and 1200 mm/min every stroke is within 2.5 %, with no note;
  - a stroke along X keeps the layer speed's code;
  - at 120 mm/min the strokes round the part fall to 81 %, and the note says so;
  - an M2 names burned tabs and not the 100 % layer;
  - an M3 has no tab note;
  - the air note appears.
- `lhy-route-planners.test.ts`: the k = 2 rectangle still runs two speeds with three stops.
- `lihuiyu-usb-job-rotary-rows.test.ts`: on the chuck, decoded rows share steps, and the K40
  job and Save `.egv` carry the row warning. A flat bed does not.
- `lihuiyu-usb-store.test.ts`:
  - Abort during a Jog and during a Home sends the reset and leaves the head unknown;
  - the warnings show after the Frame.
- `RotarySetupHost.ruida-note.test.tsx`: the K40 note no longer says whole mm/s.

### Consequences

- On a K40 rotary the head still stops when the speed class changes, but no stroke's dose
  strays more than 2.5 % unless it is below the board's slowest speed, and then the export says
  so.
- Hardware qualification is still owed.
