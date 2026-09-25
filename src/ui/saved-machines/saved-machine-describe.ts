import { selectControllerDriver } from '../../core/controllers';
import {
  describeUsbId,
  fingerprintCanIdentify,
  hasGenericUsbSerialBridge,
  type ControllerFingerprint,
} from '../../core/saved-machines/controller-fingerprint';
import type { SavedMachine } from '../../core/saved-machines/saved-machine-list';

export function savedMachineSummary(machine: SavedMachine): string {
  const profile = machine.profile;
  const controller = selectControllerDriver(
    profile.controllerKind,
    profile.controllerCommandSet,
  ).label;
  const mode = machine.machineKind === 'cnc' ? 'CNC' : 'Laser';
  return `${profile.bedWidth} × ${profile.bedHeight} mm · ${controller} · ${mode}`;
}

/** How, if at all, KerfDesk can recognise this machine when it connects. */
export function recognitionSummary(fingerprint: ControllerFingerprint | undefined): string {
  if (fingerprint === undefined) {
    return 'Controller not recorded. Connect this machine and save it here so KerfDesk can recognise it.';
  }
  if (!fingerprintCanIdentify(fingerprint)) {
    return hasGenericUsbSerialBridge(fingerprint)
      ? `Controller recorded, but it reported too few settings to tell it apart and its USB adapter (${describeUsbId(fingerprint) ?? ''}) is a common chip. KerfDesk will not suggest it on connect.`
      : 'Controller recorded, but it reported too little to be recognised on connect.';
  }
  return `Recognised on connect by ${recordedEvidence(fingerprint).join(', ')}.`;
}

function recordedEvidence(fingerprint: ControllerFingerprint): ReadonlyArray<string> {
  const settings = Object.keys(fingerprint.settings ?? {}).length;
  const usb = describeUsbId(fingerprint);
  return [
    ...(settings > 0 ? [`${settings} controller settings`] : []),
    ...(fingerprint.buildInfo === undefined ? [] : [`controller name “${fingerprint.buildInfo}”`]),
    ...(fingerprint.firmwareVersion === undefined
      ? []
      : [`firmware ${fingerprint.firmwareVersion}`]),
    ...(usb === null ? [] : [`USB ${usb}`]),
  ];
}
