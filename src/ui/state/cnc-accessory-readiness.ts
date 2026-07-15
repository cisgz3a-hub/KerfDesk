import type { OverrideValues, StatusReport } from '../../core/controllers/grbl';
import type { MachineKind } from '../../core/scene';

type Accessories = NonNullable<StatusReport['accessories']>;
export type ReducedOverrideAcknowledgement = OverrideValues;

export function invalidateAccessoryObservation(
  accessories: Accessories | null | undefined,
): Accessories | null {
  const retainSecondary = accessories?.secondarySpindlePresent === true;
  const retainEncoderFault = accessories?.spindleEncoderFault === true;
  const retainToolChange = accessories?.toolChangePending === true;
  if (!retainSecondary && !retainEncoderFault && !retainToolChange) return null;
  return {
    spindleCw: false,
    spindleCcw: false,
    flood: false,
    mist: false,
    ...(retainSecondary ? { secondarySpindlePresent: true } : {}),
    ...(retainEncoderFault ? { spindleEncoderFault: true } : {}),
    ...(retainToolChange ? { toolChangePending: true } : {}),
  };
}

export function cncAccessoryStartIssue(
  machineKind: MachineKind,
  accessories: Accessories | null | undefined,
): string | null {
  if (machineKind !== 'cnc') return null;
  if (accessories == null) {
    return (
      'CNC Start requires a fresh GRBL accessory-state observation before the controlled preamble. ' +
      'Wait for an Ov:/A: status report that confirms spindle and coolant state.'
    );
  }
  if (accessories.secondarySpindlePresent === true) {
    return (
      'CNC Start is blocked because grblHAL reports a secondary system spindle (SPn:). ' +
      "KerfDesk does not yet model that spindle's selection, stop, or recovery semantics."
    );
  }
  if (accessories.spindleEncoderFault === true) {
    return (
      'CNC Start is blocked because grblHAL reports a spindle encoder fault (A:E). ' +
      'Inspect the spindle feedback hardware and clear the controller fault before starting.'
    );
  }
  if (accessories.toolChangePending === true) {
    return (
      'CNC Start is blocked because grblHAL reports a firmware-managed tool change still pending (A:T). ' +
      'Complete or cancel that controller workflow before starting a new job.'
    );
  }
  const active = activeAccessoryLabels(accessories);
  if (active.length === 0) return null;
  return (
    `CNC Start requires spindle and coolant off before the controlled preamble. GRBL currently reports active: ${active.join(', ')}. ` +
    'Stop them with M5 and M9, then wait for a fresh all-off status report before starting.'
  );
}

export function cncOverrideStartIssue(
  machineKind: MachineKind,
  overrides: OverrideValues | null | undefined,
): string | null {
  if (machineKind !== 'cnc') return null;
  if (overrides == null) {
    return (
      'CNC Start requires a fresh GRBL override observation before streaming. ' +
      'Wait for an Ov: status report that confirms feed, rapid, and spindle overrides.'
    );
  }
  if (overrideIsBaseline(overrides) || overrideIsSafeReduction(overrides)) return null;
  return (
    'CNC Start blocks increased or invalid controller overrides. ' +
    `${overrideValuesLabel(overrides)} Keep feed, rapid, and spindle within 1-100%.`
  );
}

export function cncOverrideStartWarning(
  machineKind: MachineKind,
  overrides: OverrideValues | null | undefined,
): string | null {
  if (machineKind !== 'cnc' || overrides == null || !overrideIsSafeReduction(overrides))
    return null;
  if (overrideIsBaseline(overrides)) return null;
  return (
    `CNC will start with reduced controller overrides: feed ${overrides.feed}%, rapid ${overrides.rapid}%, spindle ${overrides.spindle}%. ` +
    'Reduced motion or spindle speed can change chip load, heat, and cut quality. Confirm these exact values are safe for the stock and tool.'
  );
}

export function reducedOverrideAcknowledgement(
  overrides: OverrideValues | null | undefined,
): ReducedOverrideAcknowledgement | undefined {
  if (overrides == null || overrideIsBaseline(overrides) || !overrideIsSafeReduction(overrides)) {
    return undefined;
  }
  return { ...overrides };
}

export function cncOverrideFinalStartIssue(
  machineKind: MachineKind,
  overrides: OverrideValues | null | undefined,
  acknowledged: ReducedOverrideAcknowledgement | undefined,
): string | null {
  const blocker = cncOverrideStartIssue(machineKind, overrides);
  if (blocker !== null || machineKind !== 'cnc' || overrides == null) return blocker;
  if (overrideIsBaseline(overrides)) return null;
  if (acknowledged === undefined) {
    return `CNC Start requires acknowledgement of the exact reduced feed/rapid/spindle values. ${overrideValuesLabel(overrides)}`;
  }
  if (overrideValuesEqual(overrides, acknowledged)) return null;
  return (
    'Controller overrides changed after acknowledgement. ' +
    `${overrideValuesLabel(overrides)} Review and confirm the new values before starting.`
  );
}

function overrideIsBaseline(overrides: OverrideValues): boolean {
  return overrides.feed === 100 && overrides.rapid === 100 && overrides.spindle === 100;
}

function overrideIsSafeReduction(overrides: OverrideValues): boolean {
  return (
    Number.isFinite(overrides.feed) &&
    Number.isFinite(overrides.rapid) &&
    Number.isFinite(overrides.spindle) &&
    overrides.feed > 0 &&
    overrides.feed <= 100 &&
    overrides.rapid > 0 &&
    overrides.rapid <= 100 &&
    overrides.spindle > 0 &&
    overrides.spindle <= 100
  );
}

function overrideValuesEqual(left: OverrideValues, right: OverrideValues): boolean {
  return left.feed === right.feed && left.rapid === right.rapid && left.spindle === right.spindle;
}

function overrideValuesLabel(overrides: OverrideValues): string {
  return `Current live values are feed ${overrides.feed}%, rapid ${overrides.rapid}%, spindle ${overrides.spindle}%.`;
}

function activeAccessoryLabels(accessories: Accessories): string[] {
  const active: string[] = [];
  if (accessories.spindleCw) active.push('clockwise spindle');
  if (accessories.spindleCcw) active.push('counter-clockwise spindle');
  if (accessories.flood) active.push('flood coolant');
  if (accessories.mist) active.push('mist coolant');
  return active;
}
