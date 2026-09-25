// What a controller reports about itself, kept with a saved machine so a later
// connection can be recognised (ADR-374). LightBurn's Find My Laser only
// probes ports while a device is being added; here each saved machine
// remembers what its controller said, and the rules below decide when a new
// connection agrees with a record strongly enough to be worth a notice.

import type { GrblBuildInfo } from '../controllers/grbl/build-info';
import type { ControllerKind } from '../devices';

export type ControllerFingerprint = {
  /** Firmware family from the welcome banner. */
  readonly firmware?: ControllerKind;
  /** Stock GRBL `$I` protocol and build date, e.g. "1.1h.20190830". */
  readonly firmwareVersion?: string;
  /** Text the operator stored on the controller with `$I=...`. */
  readonly buildInfo?: string;
  /** `$I` compile options and buffer sizes, e.g. "VNMZL,15,128". */
  readonly buildOptions?: string;
  readonly usbVendorId?: number;
  readonly usbProductId?: number;
  /** Identity-bearing `$$` values by code, e.g. { "$100": "80.000" }. */
  readonly settings?: Readonly<Record<string, string>>;
};

export type ControllerIdentityEvidence = {
  readonly firmware: ControllerKind | null;
  readonly buildInfo: GrblBuildInfo | null;
  readonly usb: { readonly usbVendorId?: number; readonly usbProductId?: number } | null;
  readonly settings: ReadonlyArray<{ readonly code: string; readonly rawValue: string }>;
};

// Settings that describe the machine's mechanics and output wiring rather than
// tuning an operator changes between jobs: step and homing direction masks,
// spindle/laser range and mode, steps per mm and configured travel.
export const IDENTITY_SETTING_CODES: ReadonlyArray<string> = [
  '$3',
  '$22',
  '$23',
  '$30',
  '$31',
  '$32',
  '$100',
  '$101',
  '$102',
  '$130',
  '$131',
  '$132',
];

export const MIN_MATCHING_SETTINGS = 3;

// USB-to-serial bridges (WCH CH340, Silicon Labs CP210x, FTDI, Prolific) sit in
// front of many unrelated controllers, so their ids alone never name a machine.
const GENERIC_USB_SERIAL_VENDORS: ReadonlySet<number> = new Set([0x1a86, 0x10c4, 0x0403, 0x067b]);

const SCALAR_KEYS = [
  'firmware',
  'firmwareVersion',
  'buildInfo',
  'buildOptions',
  'usbVendorId',
  'usbProductId',
] as const;

export function controllerFingerprintFromEvidence(
  evidence: ControllerIdentityEvidence,
): ControllerFingerprint {
  const build = evidence.buildInfo;
  const userInfo = build?.userInfo.trim() ?? '';
  const settings = identitySettings(evidence.settings);
  return {
    ...(evidence.firmware === null ? {} : { firmware: evidence.firmware }),
    ...(build === null ? {} : buildFields(build)),
    ...(userInfo === '' ? {} : { buildInfo: userInfo }),
    ...usbFields(evidence.usb),
    ...(Object.keys(settings).length === 0 ? {} : { settings }),
  };
}

/** True when a recorded fingerprint holds enough to ever recognise the machine. */
export function fingerprintCanIdentify(fingerprint: ControllerFingerprint): boolean {
  return (
    Object.keys(fingerprint.settings ?? {}).length >= MIN_MATCHING_SETTINGS ||
    fingerprint.buildInfo !== undefined ||
    distinctiveUsb(fingerprint)
  );
}

/** Null unless every recorded feature the connection reported agrees and at
 * least one of them actually identifies hardware. Otherwise the reasons, for
 * the notice: "12 controller settings", "USB 303A:1001". */
export function fingerprintMatchBasis(
  recorded: ControllerFingerprint,
  observed: ControllerFingerprint,
): ReadonlyArray<string> | null {
  if (SCALAR_KEYS.some((key) => conflicts(recorded[key], observed[key]))) return null;
  const settings = recordedSettingsMatched(recorded.settings, observed.settings);
  if (settings === null) return null;
  const agreement = agreementOf(recorded, observed, settings);
  return identifiesHardware(agreement, recorded) ? describeAgreement(agreement) : null;
}

type Agreement = {
  readonly settings: number;
  readonly buildInfo: string | null;
  readonly firmwareVersion: string | null;
  readonly usb: string | null;
};

function conflicts(want: string | number | undefined, got: string | number | undefined): boolean {
  return want !== undefined && got !== undefined && want !== got;
}

function agreementOf(
  recorded: ControllerFingerprint,
  observed: ControllerFingerprint,
  settings: number,
): Agreement {
  const usb = describeUsbId(recorded);
  return {
    settings,
    buildInfo: agreedText(recorded.buildInfo, observed.buildInfo),
    firmwareVersion: agreedText(recorded.firmwareVersion, observed.firmwareVersion),
    usb: usb !== null && usb === describeUsbId(observed) ? usb : null,
  };
}

function agreedText(recorded: string | undefined, observed: string | undefined): string | null {
  return recorded !== undefined && recorded === observed ? recorded : null;
}

function identifiesHardware(agreement: Agreement, recorded: ControllerFingerprint): boolean {
  if (agreement.settings >= MIN_MATCHING_SETTINGS || agreement.buildInfo !== null) return true;
  return agreement.usb !== null && !hasGenericUsbSerialBridge(recorded);
}

function describeAgreement(agreement: Agreement): ReadonlyArray<string> {
  return [
    ...(agreement.settings > 0 ? [`${agreement.settings} controller settings`] : []),
    ...(agreement.buildInfo === null ? [] : [`controller name “${agreement.buildInfo}”`]),
    ...(agreement.firmwareVersion === null ? [] : [`firmware ${agreement.firmwareVersion}`]),
    ...(agreement.usb === null ? [] : [`USB ${agreement.usb}`]),
  ];
}

export function describeUsbId(fingerprint: ControllerFingerprint): string | null {
  if (fingerprint.usbVendorId === undefined || fingerprint.usbProductId === undefined) return null;
  return `${hex4(fingerprint.usbVendorId)}:${hex4(fingerprint.usbProductId)}`;
}

export function hasGenericUsbSerialBridge(fingerprint: ControllerFingerprint): boolean {
  return (
    fingerprint.usbVendorId !== undefined && GENERIC_USB_SERIAL_VENDORS.has(fingerprint.usbVendorId)
  );
}

/** Recorded settings must all be present and equal; returns how many matched,
 * or null when one differs or the connection did not report it. */
function recordedSettingsMatched(
  recorded: ControllerFingerprint['settings'],
  observed: ControllerFingerprint['settings'],
): number | null {
  const entries = Object.entries(recorded ?? {});
  if (entries.length === 0) return 0;
  if (observed === undefined) return null;
  for (const [code, value] of entries) {
    const reported = observed[code];
    if (reported === undefined || !sameSettingValue(value, reported)) return null;
  }
  return entries.length;
}

function buildFields(build: GrblBuildInfo): Partial<ControllerFingerprint> {
  return {
    firmwareVersion: `${build.protocolVersion}.${build.buildRevision}`,
    buildOptions: `${build.optionCodes.join('')},${build.plannerBufferBlocks},${build.rxBufferBytes}`,
  };
}

function identitySettings(
  rows: ControllerIdentityEvidence['settings'],
): Readonly<Record<string, string>> {
  const settings: Record<string, string> = {};
  for (const row of rows) {
    const value = row.rawValue.trim();
    if (IDENTITY_SETTING_CODES.includes(row.code) && value !== '') settings[row.code] = value;
  }
  return settings;
}

function usbFields(usb: ControllerIdentityEvidence['usb']): Partial<ControllerFingerprint> {
  if (usb === null || usb.usbVendorId === undefined || usb.usbProductId === undefined) return {};
  return { usbVendorId: usb.usbVendorId, usbProductId: usb.usbProductId };
}

function distinctiveUsb(fingerprint: ControllerFingerprint): boolean {
  return describeUsbId(fingerprint) !== null && !hasGenericUsbSerialBridge(fingerprint);
}

function sameSettingValue(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  if (a === b) return true;
  if (a === '' || b === '') return false;
  const leftNumber = Number(a);
  const rightNumber = Number(b);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
}

function hex4(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, '0');
}
