// GRBL `$32` is not the same setting across the firmware family KerfDesk
// talks to, so it cannot be modelled as a boolean.
//
//   grbl 1.1  A laser-mode bitflag. settings.c stores it as
//             `if (int_value) { settings.flags |= BITFLAG_LASER_MODE; }` and
//             report.c prints `bit_istrue(settings.flags, BITFLAG_LASER_MODE)`,
//             so a stock grbl board can only ever REPORT 0 or 1.
//   grblHAL   A three-way "Mode of operation" enum. system.h declares
//             `machine_mode_t { Mode_Standard = 0, Mode_Laser, Mode_Lathe }`
//             and settings.c registers $32 with the radio-button option list
//             "Normal,Laser mode,Lathe mode", so a lathe reports $32=2.
//   FluidNC   A read-only compatibility proxy over a boolean:
//             `INT_PROXY("32", "Grbl/LaserMode", spindle->isRateAdjusted())`,
//             so it too only ever reports 0 or 1.
//
// A reported 2 is therefore unambiguous: only grblHAL emits it, and it means
// Lathe. Reading $32 as a boolean discarded that value, which left a lathe
// indistinguishable from a controller that never reported $32 at all.
//
// Pure-core compliant: no I/O, no clock, no random.

/**
 * The machine mode a controller reported through `$32`. The `unrecognized`
 * arm keeps the raw text so operator-facing messages can quote what the
 * controller actually said instead of inventing a meaning for it.
 */
export type GrblMachineMode =
  | { readonly kind: 'standard' }
  | { readonly kind: 'laser' }
  | { readonly kind: 'lathe' }
  | { readonly kind: 'unrecognized'; readonly raw: string };

const MODE_BY_REPORTED_VALUE: ReadonlyMap<number, GrblMachineMode> = new Map([
  [0, { kind: 'standard' }],
  [1, { kind: 'laser' }],
  [2, { kind: 'lathe' }],
]);

// Keyed by every arm of the union, so adding a mode is a compile error here
// rather than a silent `undefined` at runtime.
const LASER_MODE_BY_KIND: Readonly<Record<GrblMachineMode['kind'], boolean | undefined>> = {
  standard: false,
  laser: true,
  lathe: false,
  unrecognized: undefined,
};

/**
 * Interpret a raw `$32` value from a `$$` dump. Returns `undefined` when the
 * dump did not report `$32` at all — "absent" and "reported something we do
 * not recognise" are different facts and downstream advisories rely on the
 * difference.
 */
export function parseGrblMachineMode(raw: string | undefined): GrblMachineMode | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  // Firmware truncates a float before APPLYING $32, but no firmware ever
  // reports a fractional mode. Rounding one here would invent a fact.
  if (!Number.isInteger(value)) return { kind: 'unrecognized', raw: trimmed };
  return MODE_BY_REPORTED_VALUE.get(value) ?? { kind: 'unrecognized', raw: trimmed };
}

/**
 * Whether GRBL laser mode is on. grblHAL holds a single mode enum, so a lathe
 * is proof that laser mode is OFF — a known false, not an unknown. Returns
 * `undefined` only when the reported value proves neither.
 */
export function isLaserModeEnabled(mode: GrblMachineMode): boolean | undefined {
  return LASER_MODE_BY_KIND[mode.kind];
}
