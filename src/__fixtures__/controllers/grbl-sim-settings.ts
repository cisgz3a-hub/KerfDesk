// Default $$ settings table for the GRBL v1.1 simulator. Values mirror a
// plausible 400×400 diode machine with homing enabled and laser mode on —
// chosen so the app's detected-settings pipeline sees a coherent controller.

export const DEFAULT_GRBL_SIM_SETTINGS: ReadonlyArray<readonly [number, string]> = [
  [0, '10'], // step pulse, µs
  [1, '25'], // step idle delay, ms
  [2, '0'],
  [3, '0'],
  [4, '0'],
  [5, '0'],
  [10, '1'], // status report mask: MPos
  [11, '0.010'], // junction deviation, mm
  [12, '0.002'],
  [13, '0'],
  [20, '0'], // soft limits
  [21, '0'], // hard limits
  [22, '1'], // homing enabled
  [23, '0'], // homing direction mask
  [24, '25.000'],
  [25, '500.000'],
  [26, '250'],
  [27, '1.000'],
  [30, '1000'], // max spindle/laser S value
  [31, '0'], // min S value
  [32, '1'], // laser mode ON
  [100, '80.000'],
  [101, '80.000'],
  [102, '400.000'],
  [110, '6000.000'], // X max rate, mm/min
  [111, '6000.000'], // Y max rate
  [112, '600.000'],
  [120, '500.000'], // X accel, mm/s²
  [121, '500.000'], // Y accel
  [122, '50.000'],
  [130, '400.000'], // X max travel, mm
  [131, '400.000'], // Y max travel
  [132, '80.000'],
];

export function defaultGrblSimSettings(): Map<number, string> {
  return new Map(DEFAULT_GRBL_SIM_SETTINGS);
}
