## ADR-394 - The Ruida .rd export follows meerk40t's writer and runs Save G-code's checks (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

Amends ADR-097 (Ruida `.rd` export, file-only transport). The Frame-first Start contract
(PROJECT.md non-negotiable 21, ADRs 228, 230, 232, 237 and 372) is unchanged: a Ruida profile has no
live Start, and every new export finding is an advisory that never refuses the export.

### Context

Controller audit 2026-09-25, findings RU-1 to RU-8. The `.rd` encoder wrote only the part table and
a `CA 02 n` layer select, so no layer set its own speed, power or air (RU-1, RU-5). It always wrote
`D8 12`, meerk40t's "current position" reference point, whatever the export placement (RU-2). It
ended with `EB` with no matching `EA` and no layer end (RU-3), and it appended a stationary cut to
every closed segment, whose polyline already ends on its first point (RU-4). Connect was offered
for the file-only profile on the menu and palette (RU-6), the export skipped the bed and no-go
checks a G-code save runs (RU-7), and the unwired UDP session split datagrams mid-command and
waited forever for a lost reply (RU-8).

No reference `.rd` accepted by a real Ruida controller exists. The oracle is meerk40t at
`7e82652f`: its `RDJob` writer (`rdjob.py` `write_header` L1401-1504, `write_settings`
L1516-1548, `write_layer_end` L1511-1515, `write_tail` L1550-1554, `jump`/`mark` L1563-1580) and
its `RDJob.process` parser.

### Decision

1. **Write order** follows meerk40t: header, then per layer its settings, moves and layer end, then
   the file sum and End Of File. Coordinates stay absolute integer µm; the swizzle magic stays
   0x88.
2. **Reference point (RU-2).** No placement or Absolute writes `D8 10` (machine zero); User Origin
   and Verified Origin write `D8 11` (the anchor point set on the controller); Current Position
   writes `D8 12`. What a controller does with each mode is not confirmed on hardware.
3. **Header** as meerk40t writes it: the preamble `D8 1x`, `E6 01`, `F0`, `F1 02 00`, `D8 00`,
   `E7 06`, `E7 38`; job bounds in meerk40t's corner order (`E7 03`/`E7 50` = max x, min y;
   `E7 07`/`E7 51` = min x, max y); the per-part table (`C9 04` speed, `C6 31/32/41/42` power,
   `CA 06` colour, `CA 41` work mode, `E7 52/53/61/62` bounds); `CA 22` last part; the pen,
   layer and display offsets; and meerk40t's array records, including its `E7 08` values, which
   meerk40t itself marks "Unknown".
4. **Each layer sets its own speed, power and air (RU-1, RU-5):** `CA 02 p`, `CA 01 10`,
   `CA 01 13` (air on) or `CA 01 12` (air off), `C9 02` speed, `C6 12/13` delays of 0,
   `C6 01/02/21/22` power (min = max = the layer power; laser 2 = laser 1), `CA 03 01`. Air off is
   written explicitly, unlike meerk40t, so one layer's air cannot carry into the next.
5. **Layer end and tail (RU-3):** every layer ends `E7 00`, `CA 01 00`, `CA 01 30`; the file ends
   `E5 05 <sum>` (every unswizzled byte before it, plus 0xD7) and `D7`. No `EB` is written, as in
   meerk40t; an RDWorks sample does write one, which stays unsettled.
6. **No stationary moves (RU-4).** A travel or cut to the head's own position is skipped, as
   meerk40t's `jump`/`mark` return on a zero delta. A job whose every segment collapses to a point
   is refused as empty instead of producing zero-length cuts.
7. **Export checks (RU-7).** The export runs the same post-compile preflight a G-code save runs,
   over the exact planned moves (a travel as `G0 X Y S0`, a cut as `G1 X Y S<power>`), in the frame
   Save G-code would use, with the rotary wrap limit. "Line N:" becomes "Layer <id>:". Findings are
   advisories.
8. **Connect (RU-6).** A file-only driver is refused inside the Connect action before any port is
   requested, with "This machine profile exports .rd files only; it has no live connection.", and
   the menu and palette Connect command is disabled with the same text.
9. **UDP session (RU-8), still unwired:** datagrams split only between commands (at most 1470
   bytes, meerk40t controller.py L83-94); a command longer than a datagram fails the session; no
   ACK or NAK within 1 s (meerk40t ruidasession.py L352-369) fails it without a resend, because UDP
   carries no sequence number and a resend after a lost ACK would run the same commands twice.
   Replies go to host port 40200 (meerk40t udp_transport.py L16-18).

### Consequences

- meerk40t's unmodified `RDJob.process` reads a two-layer export with each layer's speed and power
  intact and no unknown command (the audit agent's oracle run).
- Power is rounded to the 14-bit scale where meerk40t truncates, a difference of at most one unit.
- A Ruida profile has no live homing evidence, so from Save an enabled no-go zone gives the G-code
  save's "cannot be checked from this hand-set origin" advisory, and the bed check covers the job's
  size only.
- None of this has run on a Ruida controller.
- Regression tests: `rd-encoder.test.ts`, `rd-encoder-golden.test.ts`, `ruida.test.ts`,
  `swizzle-meerk40t.test.ts`, `ruida-udp-session.test.ts`, `emit-rd.test.ts`,
  `rd-preflight.test.ts`, `save-rd-action.test.ts`, `output-preparation-rd.test.ts`,
  `laser-connect-file-only.test.ts`, `laser-command-family.test.ts`, `connect-options.test.ts`.
