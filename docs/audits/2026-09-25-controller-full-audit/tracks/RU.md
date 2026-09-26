# Track RU — Ruida (raw track report, unverified by the lead)

Saved verbatim in substance from the track's hand-back on 2026-09-25. The lead's independent
verification is recorded in the final report; until then treat every item as the track's claim.

Oracle: meerk40t's unmodified `ruida/rdjob.py` at 7e82652f75dcab39413492e60ed5b60e5c0ad7b6,
imported in python3 with only the numpy raster module stubbed (`RU-oracle/m40t.py`). KerfDesk's
output was decoded with meerk40t's own `RDJob.process`, and the same two-layer job was encoded
with meerk40t's writer (`write_header` → `write_settings` → `jump`/`mark` → `write_tail`, the
order `RuidaDriver.plot_start` uses). Scripts and byte dumps are in `RU-oracle/` (set `UP` in
`m40t.py` to a local meerk40t checkout).

Command order for the same two-layer job (unswizzled):

- **KerfDesk:** `D8 12` · `E7 03/07/50/51` · part table (`C9 04`, `C6 31`, `C6 32`, `CA 06`) ×2 ·
  `CA 02 0` · `88`, `A8`… · `CA 02 1` · `88`, `A8` · `EB` · `D7`
- **meerk40t:** `D8 10`, `E6 01`, `F0`, `F1 02 00`, `D8 00`, `E7 06`, `E7 38`, `E7 03/07/50/51`,
  `E7 04`, `E7 05`; per part `C9 04`, `C6 31/32/41/42`, `CA 06`, `CA 41`, `E7 52/53/61/62`;
  `CA 22`, `E7 54/55`, `F1 03`, `E7 0A`, `EA 00`, `E7 60/0B/13/17/23/24`, `E7 08`; per layer
  `CA 02 n`, `CA 01 10`, `C9 02`, `C6 12/13`, `C6 01/02/21/22`, `CA 03 01`, moves, `E7 00`,
  `CA 01 00`, `CA 01 30`; `E5 05`, `D7`

## Findings

### RU-1 — Layer bodies never set their own speed or power (high)

CONFIRMED against meerk40t's decoder model; effect on a real controller PLAUSIBLE. New.

A two-layer job (50 mm/s at 20%, 5 mm/s at 80%) decodes in meerk40t's `RDJob` as both layers at
5.0 mm/s (the last part-table speed) with power None; meerk40t's own encoding gives 50/20% and
5/80%. `rd-encoder.ts:90-102` emits the part table (`C9 04`, `C6 31/32`, `CA 06`) for all layers,
then each body is only `CA 02 <n>` plus segments. `rd-commands.ts` has no `C9 02`, `C6 01` or
`C6 02` builder, and the test decoder (`src/__fixtures__/controllers/ruida-decoder.ts:66-70,86`)
only understands the part-table forms, so the round-trip tests cannot see the gap.

Upstream: rdjob.py L1517-1548 `write_settings` (`layer_number_part`, `speed_laser_1`,
`min_power_1`, `max_power_1`, `min_power_2`, `max_power_2`, `en_laser_tube_start(1)`); L853-865
only `C6 01/02` set the active power; L904-911 `C6 31/32` only store part values. EduTech RDWorks
sample: `ca0200` … `c9020000060d20 (Speed Laser 1 100 mm/s)` … `c6011319` `c6021828` … `ca030d`.
https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L1517-L1548
https://edutechwiki.unige.ch/en/Ruida

Repro: `src/__audit_repro__/RU/ruida-rd-layer-settings.test.ts` fails. Fix (local): after
`CA 02 <part>` emit `C9 02` speed and `C6 01/02` power (ideally the full `write_settings`
sequence incl. `CA 01 10`, `C6 21/22`, `CA 03 01`); extend the test decoder.

### RU-2 — Every file declares "Ref Point Mode 0 – Current Position" (high)

Bytes CONFIRMED; controller placement behaviour PLAUSIBLE. New.

`rd-commands.ts:82-85` labels `D8 12` a "start-of-stream marker"; `rd-encoder.ts:88` writes it
for every placement. meerk40t rdjob.py L135-137: `REF_POINT_2 = D8 10 # MACHINE_ZERO/ABS`,
`REF_POINT_1 = D8 11 # ANCHOR_POINT`, `REF_POINT_0 = D8 12 # CURRENT_POSITION`; `write_header`
L1409-1414 writes `ref_point_2(); set_absolute(); ref_point_set(); enable_block_cutting(0);
start_process()`. EduTech: "0xD8 0x12 | Ref Point Mode 0", "0xD8 0x00 | Start Process". An
Absolute export (machine coordinates from home) therefore tells the controller to place the job
at the head position; the generic Ruida profile (homing off) defaults to User Origin
(`ui/job-placement.ts:28-39`) and still declares Current Position. No `D8 00` Start Process is
ever written. https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L135-L137

Repro: `ruida-rd-reference-mode.test.ts` fails. Fix: local for Absolute (meerk40t preamble
`D8 10`, `E6 01`, `F0`, `F1 02 00`, `D8 00`; rename the builder; fix decoder label). User Origin
(`D8 11`) semantics for anchor-relative coordinates are unverified — needs decision.

### RU-7 — `.rd` export never runs the post-compile checks (no-go zones etc.) (medium)

CONFIRMED. New. `src/io/rd/emit-rd.ts:20` "The .rd path runs no post-compile preflight"; the zone
check lives only in `runPreflight(project, gcode)` (`core/preflight/preflight.ts:155`), which the
G-code save runs. The Ruida profile has the `'no-go-zones'` capability (`profile-catalog.ts:154`),
and `MachineSetupSafetyZones.tsx:35-36` promises a warning "after a successful G-code save". For
Ruida the export is the only output path, so no collision/out-of-bed/laser-travel warning appears.
Repro: `ruida-rd-no-go-zones.test.ts` (control passes; `.rd` fails). Fix (local, advisory only per
ADR-228): run the same post-compile checks on the prepared job and return them as advisories.

### RU-3 — Unpaired `EB` used as "block end"; real Block End / End Layer missing (medium)

Bytes CONFIRMED; controller reaction PLAUSIBLE. New. Every file ends `EB D7` with no `EA` Array
Start, no `E7 00` Block End and no `CA 01 00` End Layer; also missing `CA 41`, `E7 52/53/61/62`,
`CA 22`, `E7 04/05/06`. `rd-commands.ts:87-90`, `rd-encoder.ts:104-105`. meerk40t rdjob.py L175
`BLOCK_END = E7 00`, L205-206 `ARRAY_START = EA`/`ARRAY_END = EB`, L102 `LAYER_END = CA 01 00`,
`write_header` L1496 `array_start(0)`, `write_layer_end` L1511-1515. EduTech sample has `ea00` in
the header and ends `eb`, `e700`, …, `d7`. Repro: `ruida-rd-block-structure.test.ts` fails. Fix
(local): write `EA 00` with meerk40t's array header (L1495-1504) or drop `EB`; close each layer
with `E7 00`, `CA 01 00`, `CA 01 30`; add the per-part header records.

### RU-5 — Layer "Air assist" silently dropped from `.rd` (medium)

Bytes CONFIRMED; physical effect PLAUSIBLE. New. `core/job/job.ts:67` `airAssist`; nothing in
`rd-encoder.ts`/`rd-commands.ts` reads it. `airAssist` true/false export identical bytes.
meerk40t rdjob.py L111-112 `AIR_ASSIST_OFF = CA 01 12`, `AIR_ASSIST_ON = CA 01 13`, written per
layer by `write_settings` L1532-1536; EduTech sample contains `ca0113 (Air Assist On)`. Repro:
`ruida-rd-air-assist.test.ts` fails. Fix (local): emit `CA 01 13`/`CA 01 12` per layer body.

### RU-6 — Menu/command "Connect" opens a serial port for the file-only Ruida profile (medium)

CONFIRMED. New. Machine menu → Connect is enabled when `ctx.serialSupported && !ctx.connected`
(`ui/commands/laser-command-family.ts:11-20`, `use-app-commands.ts:194,282-283`);
`ui/state/laser-connect-action.ts:67-89` requests and opens the port with no transport check. The
store reports connected; ~2 s later "No controller response…". The rail keeps Disconnect/Forget
disabled for file-only, so only the menu can disconnect. No bytes written; Frame/Start stay
unavailable. ADR-097 decision 3 (`DECISIONS.md:4171`) says file-only "disables Connect and all
live controls". Repro: `ruida-file-only-connect.test.ts` fails (`requestPort` called once). Fix
(local; factual transport inability, so a refusal is allowed): disable `laser.connect` for a
`'file-only'` driver and refuse it in `runConnectAction` before `requestPort`.

### RU-4 — Every closed contour ends with a zero-length powered cut (low)

Bytes CONFIRMED; seam-dot effect PLAUSIBLE. New. `rd-encoder.ts:159`
`if (closed) push(cutAbsolute(first))` although closed segments already end on their first point
(`core/job/job.ts:35-36`); the G-code path refuses stationary powered moves
(`grbl-strategy.ts:139-143`). meerk40t `mark` L1577-1580 returns when `dx == 0 and dy == 0`.
Repro: `ruida-rd-stationary-cut.test.ts` fails. Fix (local): skip an `A8` whose µm target equals
the current position.

### RU-8 — UDP session cannot recover from a lost reply (low, latent)

CONFIRMED in code; unreachable today (nothing outside tests calls `createRuidaSession`). No
timeout transition from `awaiting-ack`; slices every 1470 bytes regardless of command
boundaries (`ruida-udp-session.ts:115,154-156,177-201`). meerk40t ruidasession.py L352-369
(timeouts → comms failure), controller.py L83-94 (~1000-byte chunks at command boundaries),
udp_transport.py L17-18 (host listens on 40200). Fix (local, before wiring a socket): timeout/ERR
state, command-boundary chunking, bind 40200.

## Checked and correct (per the track)

- Swizzle/unswizzle identical to meerk40t for all 256 magics × 256 bytes
  (`ruida-swizzle-conformance.test.ts` passes; rdjob.py L434-449). Magic 0x88 matches meerk40t's
  default and EduTech's 644XG/644XS/320/633X/654XG.
- Absolute coordinates: 5×7-bit big-endian two's complement µm (`encode32` L281-291); power 14-bit
  (16383 = 100%, ≤1 LSB rounding difference); speed µm/s in 5 bytes; layer colour #BBGGRR.
- Opcode lengths correct; meerk40t parsed every KerfDesk file with no unknown commands.
- UDP framing: 16-bit BE checksum over swizzled payload, ≤1470-byte payload, ACK after unswizzle,
  NAK resend, ENQ ignored (ADR-362 item 7 fixes correct).
- Axis frame: rear-right origin x = bedW − sceneX, y = sceneY matches meerk40t's RDC6442S mapping.
- Frame/Start unreachable for Ruida; experimental labelling on every save; Raster/Fill refused.

## Not covered or unsettled

- No hardware and no LightBurn reference `.rd`: real acceptance, `D8 10/11/12` application and
  whether `CA 02` applies the part table are not in any upstream source.
- `E7 03/07` corner order, whether `E5 05` file sum is required, and `CA 02`'s length (3 vs 4
  bytes) are unsettled between meerk40t and EduTech.
- Rotary on Ruida and the worker `.rd` path were not examined in depth.
