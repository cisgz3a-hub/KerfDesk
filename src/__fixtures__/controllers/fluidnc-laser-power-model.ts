// fluidnc-laser-power-model — an independent oracle for the share of full
// power FluidNC drives for an S word. It ports only the two steps that decide
// it (bdring/FluidNC main and v4.0.3, controller audit v4 E1-P2-1):
//  - GCode.cpp parses S as a float, but the planner block and
//    Spindle::setState take a SpindleSpeed, which SpindleDatatypes.h declares
//    as uint32_t. `pl_data->spindle_speed = gc_state.spindle_speed` and
//    `(uint32_t)gc_block.values.s` both drop the fraction, so S0.6 runs as S0
//    and S6.98 as S6. M4's rate adjustment (Stepping.cpp) starts from that
//    already whole value.
//  - Spindle::mapSpeed maps the whole speed through the spindle's speed_map:
//    S0 or a speed below the first entry gives the first entry's percent, a
//    speed at or past the last entry gives the last entry's percent, and
//    anything between is linear between its two neighbouring entries. The
//    Laser spindle's default map is `0=0% 255=100%` (LaserSpindle.cpp
//    linearSpeeds(255, 100)), and `$30` reports the last entry's speed
//    (SettingsDefinitions.cpp INT_PROXY("30", …, spindle->maxSpeed())).
// The model returns percent of full duty. It leaves out mapSpeed's 16-bit
// fixed-point slope and the PWM period's whole counts, which move a result by
// less than one PWM count, and the spindle speed override (100% here).
// https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/SpindleDatatypes.h
// https://github.com/bdring/FluidNC/blob/main/FluidNC/src/GCode.cpp
// https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Spindles/Spindle.cpp

export type FluidncSpeedMapEntry = { readonly speed: number; readonly percent: number };

/** A hand-written `speed_map: 0=0% <top>=100%`; top 255 is the Laser default. */
export function linearFluidncSpeedMap(top: number): ReadonlyArray<FluidncSpeedMapEntry> {
  return [
    { speed: 0, percent: 0 },
    { speed: top, percent: 100 },
  ];
}

/** The whole SpindleSpeed FluidNC keeps for a parsed (non-negative) S word. */
export function fluidncSpindleSpeed(sWord: number): number {
  return Math.trunc(sWord);
}

/** Percent of full duty FluidNC drives for one S word. */
export function fluidncPowerPercent(
  sWord: number,
  speedMap: ReadonlyArray<FluidncSpeedMapEntry>,
): number {
  const speed = fluidncSpindleSpeed(sWord);
  const first = speedMap[0];
  const last = speedMap[speedMap.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (speed === 0 || speed < first.speed) return first.percent;
  for (let index = 0; index < speedMap.length - 1; index += 1) {
    const from = speedMap[index];
    const to = speedMap[index + 1];
    if (from === undefined || to === undefined || speed >= to.speed) continue;
    return (
      from.percent + ((speed - from.speed) * (to.percent - from.percent)) / (to.speed - from.speed)
    );
  }
  return last.percent;
}
