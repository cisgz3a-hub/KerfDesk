# Pro loop v3 — C3 Char-counted window

- **When:** 2026-11-08   **Tree:** `devin/pro-loop-v3` from `origin/main`
- **Harness:** `audit/loop-v1/r3-window.test.ts` (outside the repository): a 177-line dithered raster
  program from `emitGcode`, streamed through the real `createStreamer` / `step` / `onAck` into the
  simulator's RX ring (`grbl-sim-rx-window.ts`, which drops what does not fit as the AVR ISR does),
  under 60 random interleavings of host refills and controller line consumption, with the window
  capacity drawn from 64 to 128 bytes.
- **Counts:** 0 raised.

| Check | Result |
|---|---|
| Bytes dropped by the ring | 0 in every run |
| Ring over capacity | never |
| Peak ring use at a 128-byte cap | 126 bytes: the window is used nearly fully |
| Max in-flight accounting on the host | 126 bytes, equal to the ring's peak |

The host's in-flight count and the ring's content agree byte for byte, line terminators included.
Clean.
