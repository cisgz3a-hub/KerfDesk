// A JCZ LMC galvo's machine model (ADR-704). The lens field IS the bed: a
// galvo profile's bedWidth and bedHeight are the square field size, its origin
// is 'center' (the lens centre, as EZCad and LightBurn number a galvo field),
// and the field maps onto the board's 0..0xFFFF coordinate range. The axis
// flags mean what MeerK40t's do (balormk/device.py L183-213, realize at
// L1133-1160; core/view.py L244-293), so a setup copied from MeerK40t maps the
// same way. The rest are the timing and source defaults its list program uses
// (device.py L573-597, L618-640, L653-703, L753-755, L453-455, L345-347).
// Simulator-tested only; not qualified on hardware.

/** What fires the beam. A MOPA fiber is a fiber that also takes a pulse width
 *  (MeerK40t: source "fiber" with pulse width enabled, controller.py L650-661). */
export type GalvoLaserSource = 'fiber' | 'mopa' | 'uv' | 'co2';

export const GALVO_LASER_SOURCES: ReadonlyArray<GalvoLaserSource> = ['fiber', 'mopa', 'uv', 'co2'];

/** The MOPA pulse widths MeerK40t offers (device.py L618-640), in ns. */
export const MOPA_PULSE_WIDTHS_NS: ReadonlyArray<number> = [
  1, 2, 4, 6, 9, 13, 20, 30, 45, 55, 60, 80, 100, 150, 200, 250,
];

export type GalvoSetup = {
  readonly source: GalvoLaserSource;
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly swapXY: boolean;
  /** Q-switch (fiber) or PWM (CO2/UV) frequency a layer uses unless it sets its own. */
  readonly frequencyKhz: number;
  /** MOPA pulse width a layer uses unless it sets its own. */
  readonly pulseWidthNs: number;
  /** Jump (travel) speed between marks. */
  readonly jumpSpeedMmPerSec: number;
  /** Laser on / off delays; negative fires early / stops early. */
  readonly laserOnDelayUs: number;
  readonly laserOffDelayUs: number;
  readonly polygonDelayUs: number;
  /** Dwell after the last mark before the program ends. */
  readonly endDelayUs: number;
  /** Fiber only: wait after opening the master oscillator. */
  readonly openMoDelayMs: number;
  /** Red pointer light: its travel speed and its output port bit. */
  readonly redLightSpeedMmPerSec: number;
  readonly redLightPortBit: number;
};

export const DEFAULT_GALVO_SETUP: GalvoSetup = {
  source: 'fiber',
  flipX: false,
  flipY: true,
  swapXY: true,
  frequencyKhz: 30,
  pulseWidthNs: 4,
  jumpSpeedMmPerSec: 2000,
  laserOnDelayUs: 100,
  laserOffDelayUs: 100,
  polygonDelayUs: 100,
  endDelayUs: 300,
  openMoDelayMs: 8,
  redLightSpeedMmPerSec: 3000,
  redLightPortBit: 8,
};

/** Field sizes this build accepts, in mm (lenses ship from about 70 to 300 mm). */
export const GALVO_FIELD_MIN_MM = 20;
export const GALVO_FIELD_MAX_MM = 600;
/** Frequency range, kHz: the period words stay within a uint16 and above zero. */
export const GALVO_FREQUENCY_MIN_KHZ = 1;
export const GALVO_FREQUENCY_MAX_KHZ = 4000;

type Rule = { readonly min: number; readonly max: number; readonly integer?: boolean };

// Each numeric field's range: what the board's uint16 words can carry
// (delays travel as magnitude plus a sign word; polygon and end delays in 10 µs
// units; the open-MO delay in 10 µs units of milliseconds × 100).
const NUMBER_RULES: Readonly<Record<NumericGalvoKey, Rule>> = {
  frequencyKhz: { min: GALVO_FREQUENCY_MIN_KHZ, max: GALVO_FREQUENCY_MAX_KHZ },
  pulseWidthNs: { min: 1, max: 0xffff, integer: true },
  jumpSpeedMmPerSec: { min: 1, max: 100_000 },
  laserOnDelayUs: { min: -0xffff, max: 0xffff, integer: true },
  laserOffDelayUs: { min: -0xffff, max: 0xffff, integer: true },
  polygonDelayUs: { min: 0, max: 655_350 },
  endDelayUs: { min: 0, max: 655_350 },
  openMoDelayMs: { min: 0, max: 655.35 },
  redLightSpeedMmPerSec: { min: 1, max: 100_000 },
  redLightPortBit: { min: 0, max: 15, integer: true },
};

type NumericGalvoKey = Exclude<keyof GalvoSetup, 'source' | 'flipX' | 'flipY' | 'swapXY'>;

function numberIssue(key: NumericGalvoKey, value: unknown): string | null {
  const rule = NUMBER_RULES[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${key} must be a number`;
  if (rule.integer === true && !Number.isInteger(value)) return `${key} must be a whole number`;
  if (value < rule.min || value > rule.max) return `${key} must be ${rule.min}..${rule.max}`;
  return null;
}

/** Why a value is not a usable galvo setup, or null. */
export function galvoSetupIssue(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return 'galvo must be an object';
  const record = value as Record<string, unknown>;
  if (!(GALVO_LASER_SOURCES as ReadonlyArray<unknown>).includes(record['source']))
    return `galvo.source must be one of ${GALVO_LASER_SOURCES.join(', ')}`;
  for (const flag of ['flipX', 'flipY', 'swapXY'] as const) {
    if (typeof record[flag] !== 'boolean') return `galvo.${flag} must be true or false`;
  }
  for (const key of Object.keys(NUMBER_RULES) as NumericGalvoKey[]) {
    const issue = numberIssue(key, record[key]);
    if (issue !== null) return `galvo.${issue}`;
  }
  return null;
}

/** The setup with only its own fields, or undefined when it is not valid. */
export function normalizeGalvoSetup(value: unknown): GalvoSetup | undefined {
  if (galvoSetupIssue(value) !== null) return undefined;
  const record = value as GalvoSetup;
  return {
    source: record.source,
    flipX: record.flipX,
    flipY: record.flipY,
    swapXY: record.swapXY,
    frequencyKhz: record.frequencyKhz,
    pulseWidthNs: record.pulseWidthNs,
    jumpSpeedMmPerSec: record.jumpSpeedMmPerSec,
    laserOnDelayUs: record.laserOnDelayUs,
    laserOffDelayUs: record.laserOffDelayUs,
    polygonDelayUs: record.polygonDelayUs,
    endDelayUs: record.endDelayUs,
    openMoDelayMs: record.openMoDelayMs,
    redLightSpeedMmPerSec: record.redLightSpeedMmPerSec,
    redLightPortBit: record.redLightPortBit,
  };
}

/** A layer's own galvo frequency, when it sets one within range. */
export function isGalvoFrequencyKhz(value: unknown): value is number {
  return numberIssue('frequencyKhz', value) === null;
}

/** A layer's own MOPA pulse width, when it sets a whole number of ns. */
export function isGalvoPulseWidthNs(value: unknown): value is number {
  return numberIssue('pulseWidthNs', value) === null;
}
