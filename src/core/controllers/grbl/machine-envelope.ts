export type AxisBounds = { readonly minMm: number; readonly maxMm: number };
export type MachineEnvelope = {
  readonly x: AxisBounds;
  readonly y: AxisBounds;
  readonly z: AxisBounds;
};
export type AxisTravel = { readonly x: number; readonly y: number; readonly z: number };
export type EnvelopeSettings = {
  readonly statusReportMask: number;
  readonly reportInches: boolean;
  readonly softLimitsEnabled: boolean;
  readonly homingEnabled: boolean;
  readonly homingDirectionMask: number;
  readonly homingPullOffMm: number;
  readonly maxTravelMm: AxisTravel;
};

const MM_PER_INCH = 25.4;

export function deriveMachineEnvelope(
  travel: AxisTravel,
  homingDirectionMask: number,
  homingForceOrigin: boolean,
): MachineEnvelope {
  assertDirectionMask(homingDirectionMask);
  return {
    x: deriveAxisBounds(travel.x, Boolean(homingDirectionMask & 1), homingForceOrigin),
    y: deriveAxisBounds(travel.y, Boolean(homingDirectionMask & 2), homingForceOrigin),
    z: deriveAxisBounds(travel.z, Boolean(homingDirectionMask & 4), homingForceOrigin),
  };
}

export function normalizeReportedMPosToMm(
  position: readonly [number, number, number],
  reportInches: boolean,
): readonly [number, number, number] {
  if (!position.every(Number.isFinite)) throw new Error('MPos must contain finite values.');
  const scale = reportInches ? MM_PER_INCH : 1;
  return [position[0] * scale, position[1] * scale, position[2] * scale];
}

// GRBL's $13 reports the `FS:` feed rate in the same unit system as position,
// so an inch-configured controller reports inch/min. Unlike MPos this returns
// null (never throws) for a missing or non-finite sample: feed is an optional
// live readout, and a bad frame must not break the status pipeline.
export function normalizeReportedFeedRateToMm(
  feed: number | null,
  reportInches: boolean,
): number | null {
  if (feed === null || !Number.isFinite(feed)) return null;
  return feed * (reportInches ? MM_PER_INCH : 1);
}

export function validateEnvelopeSettings(
  settings: EnvelopeSettings,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (settings.statusReportMask !== 1 && settings.statusReportMask !== 3) {
    return { ok: false, reason: 'Direct MPos status reporting is required.' };
  }
  if (!settings.softLimitsEnabled)
    return { ok: false, reason: 'GRBL soft limits must be enabled.' };
  if (!settings.homingEnabled) return { ok: false, reason: 'GRBL homing must be enabled.' };
  if (!isDirectionMask(settings.homingDirectionMask)) {
    return { ok: false, reason: 'GRBL homing direction mask must be an integer from 0 to 7.' };
  }
  if (!isPositiveFinite(settings.homingPullOffMm)) {
    return {
      ok: false,
      reason: 'KerfDesk requires a finite positive homing pull-off safety margin.',
    };
  }
  if (
    ![settings.maxTravelMm.x, settings.maxTravelMm.y, settings.maxTravelMm.z].every(
      isPositiveFinite,
    )
  ) {
    return { ok: false, reason: 'GRBL maximum travels must be finite and positive.' };
  }
  return { ok: true };
}

function deriveAxisBounds(
  maxTravelMm: number,
  homingDirectionInverted: boolean,
  homingForceOrigin: boolean,
): AxisBounds {
  if (!isPositiveFinite(maxTravelMm))
    throw new Error('Maximum travel must be finite and positive.');
  return homingForceOrigin && homingDirectionInverted
    ? { minMm: 0, maxMm: maxTravelMm }
    : { minMm: -maxTravelMm, maxMm: 0 };
}

function assertDirectionMask(value: number): void {
  if (!isDirectionMask(value))
    throw new Error('Homing direction mask must be an integer from 0 to 7.');
}

function isDirectionMask(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 7;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
