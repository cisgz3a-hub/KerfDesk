## ADR-675 - A CoreXY machine limits each motor, so its diagonals get less acceleration and speed (2026-10-28)

**Status:** Accepted on 2026-10-28 |
**Amends:** ADR-495 decisions 2, 4 and 5 (the along-scan acceleration of automatic overscan, the
preflight allowance and the runway advisory), ADR-257 Amendment 1's constant-power advice, and the
time model of ADR-255 and ADR-525. It adds no Start guard: every change is a length, an estimate
or an advisory (rule 7 / ADR-228).

### Context

Rolling audit v6, report K3 (`docs/audits/2026-10-28-rolling-v6/K3-falcon-a1-pro-truth.md`),
found K3-P2-2. The refuter raised it to P1 and the coordinator confirmed it on main.

- **The Falcon A1 Pro is CoreXY.** Both published A1 Pro `$I` reads (barebaric/rayforge PR #461;
  LightBurn forum topic 177926, post 3) print `[KINEMATICS:CoreXY v2.02]` and a `C` in `[OPT:…]`.
- **grblHAL limits each motor.** This decision re-read grblHAL core at
  [`f8f10aec`](https://github.com/grblHAL/core/tree/f8f10aecdf05943e3a02b1ac3c691b666a811495), the
  commit that brought CoreXY v2.02:
  - `mc_line` hands every target to `kinematics.segment_line`
    ([motion_control.c L83](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/motion_control.c#L83)).
  - CoreXY's `segment_line` converts it to motor positions, A = X + Y and B = X − Y
    ([corexy.c L68-L78](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/kinematics/corexy.c#L68-L78)),
    and scales the feed by motor distance over Cartesian distance
    ([L197-L222](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/kinematics/corexy.c#L197-L222)).
  - The planner builds its unit vector from those motor steps
    ([planner.c L416-L420](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/planner.c#L416-L420))
    and limits a block by min aᵢ / |uᵢ| over the motors
    ([L342-L366](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/planner.c#L342-L366),
    [L504-L506](https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/planner.c#L504-L506)).
  - A head move along u turns motor A at |ux + uy| and motor B at |ux − uy| of the head's speed.
    So the move gets a / max(|ux + uy|, |ux − uy|) = **a / (|cos θ| + |sin θ|)**: a along an axis,
    a / √2 on a 45° diagonal. The same holds for the max rate, so a diagonal tops out at
    $110 / √2.
- **KerfDesk modelled every machine as Cartesian.** Automatic overscan and Job Review's runway
  advisory used a / max(|cos θ|, |sin θ|), stock GRBL's per-axis limit
  ([nuts_bolts.c L180-L190](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/nuts_bolts.c#L180-L190)):
  a·√2 at 45°, twice what CoreXY gives.
  - The shipped 500 mm/s² hid it: 500·√2 = 1000/√2.
  - KerfDesk's own tooltip and Machine Setup's automatic fill put in the firmware's `$120=1000`.
    A 45° scan at 10000 mm/min then got 10.9 mm of runway against 19.6 mm needed, the advisory
    stayed silent, and under constant power (M3) the scan edges got up to 1.34× the dose.

### Decision

1. **The device profile records its kinematics.** `kinematics?: 'cartesian' | 'corexy'`.
   Absent means Cartesian, so every saved profile and project loads as before. Profile files,
   projects and Machine Setup round-trip it; an unknown value is dropped on load.
   - The Falcon A1 Pro preset sets `corexy`. It is the only CoreXY machine in the catalogue: the
     Ortur Laser Master 3, Sculpfun S30, xTool D1 Pro and Neotronics 4040 are gantries with a motor
     per axis.
   - A saved A1 Pro copy without kinematics is named in Job Review and offered **Use CoreXY motion**
     in Machine Setup (ADR-322 Amendments 1 and 2). Nothing is migrated.
   - Machine Setup's planner fields gain **Motion layout** (Cartesian or CoreXY), beside `$120`.
     The Super Console's firmware report now shows grblHAL's `KINEMATICS` line.
2. **One drive-share rule** (`motion-planner/drive-share.ts`). A move along u gets a limit L
   divided by its busiest drive's share: max(|ux|, |uy|, |uz|) on Cartesian,
   max(|ux + uy|, |ux − uy|, |uz|) on CoreXY. The file re-derives both from the sources above.
3. **Automatic overscan and the runway advisory use it.** `alongScanAccelMmPerSec2` takes the
   kinematics, so a CoreXY scan at θ gets a / (|cos θ| + |sin θ|). The advisory adds "on this
   CoreXY machine" where the angle changes the value, and Cut Settings' notes give the reduced
   value. Cartesian lengths and text are unchanged.
4. **Preflight allows the longest automatic runway on either layout.** That is the one along an
   axis on Cartesian and the one on the diagonal on CoreXY (`longestRunwayScanAngleDeg`).
5. **The constant-power advice uses it.** An image's look-ahead speed uses the along-scan value.
   A square corner's junction speed on CoreXY is v² = a·δ·(1 + √2) / 2, against Cartesian
   v² = a·δ·(2 + √2): grblHAL plans the junction in motor space, where the corner's junction
   vector points along one motor and a motor-space speed is √2 times the head's.
6. **The time model uses it for CoreXY.** Each block is planned with the acceleration and max rate
   divided by its busiest motor's share. A corner uses the share of its junction vector and a
   junction deviation √2 shorter in head millimetres within the XY plane.
   - **Cartesian estimates are unchanged.** They keep the profile value in every direction, which
     GRBL gives a Cartesian move at least of, so they still err long.
   - **Jog and Frame.** KerfDesk keeps no model of a jog's or Frame's diagonal speed; it sends one
     feed and the firmware caps it. The A1 Pro's Frame feed of 10000 mm/min is below its 25456
     mm/min diagonal cap, so nothing changes there.
7. **Emitter revision v40.** Automatic overscan on a CoreXY profile now emits a longer runway off
   the axes; along an axis and on every Cartesian profile the bytes are unchanged.

### Alternatives

- **Halve the A1 Pro's acceleration instead.** Rejected: it would make every axis-aligned scan and
  estimate wrong to get the diagonal right, and the tooltip would still ask for `$120`.
- **Make the Cartesian time model direction-aware too.** Left out: it would shorten every existing
  Cartesian estimate on diagonals, which no finding asked for.
- **Read the kinematics from `$I` at connect.** Left out for now: the Falcon contract reads `$$` at
  connect (ADR-322 Amendment 3), and the Super Console's firmware report shows `KINEMATICS` on
  request. The preset states CoreXY from two published reads.

### Consequences

- With `$120=1000`, a 45° automatic runway at 10000 mm/min on the A1 Pro is 21.7 mm, not 10.9 mm,
  and the advisory warns about a stored 5 mm runway there.
- At the shipped 500 mm/s², CoreXY doubles a 45° automatic runway (within the 25 mm cap), and
  diagonal-heavy jobs on the A1 Pro estimate longer.
- FluidNC's CoreXY was not read, so the rule is claimed for grblHAL only.

### Verification

- `drive-share.test.ts`: both shares at 0°, 30°, 45° and 90°, and a check against a direct
  motor-space computation.
- `automatic-overscan.test.ts`: the K3 cases (1000 mm/s² at 0°, 30° and 45°) on CoreXY, and
  Cartesian unchanged.
- `scan-quality-warnings.test.ts`, `constant-power-warnings.test.ts`, `program-time-corexy.test.ts`: the
  CoreXY advisory, corner speed and estimate.
- No machine was operated. The firmware behaviour is from source, not measured.
