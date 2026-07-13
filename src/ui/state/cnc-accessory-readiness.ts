import type { OverrideValues, StatusReport } from '../../core/controllers/grbl';
import type { MachineKind } from '../../core/scene';

type Accessories = NonNullable<StatusReport['accessories']>;

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
  if (overrides.feed === 100 && overrides.rapid === 100 && overrides.spindle === 100) return null;
  return (
    'CNC Start requires controller overrides at the compiled baseline: feed 100%, rapid 100%, ' +
    `spindle 100%. Current live values are feed ${overrides.feed}%, rapid ${overrides.rapid}%, ` +
    `spindle ${overrides.spindle}%. Reset each override to 100% before starting.`
  );
}

function activeAccessoryLabels(accessories: Accessories): string[] {
  const active: string[] = [];
  if (accessories.spindleCw) active.push('clockwise spindle');
  if (accessories.spindleCcw) active.push('counter-clockwise spindle');
  if (accessories.flood) active.push('flood coolant');
  if (accessories.mist) active.push('mist coolant');
  return active;
}
