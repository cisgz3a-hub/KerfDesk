import { isKnownControllerKind } from '../../core/devices';
import type { ControllerFingerprint } from '../../core/saved-machines/controller-fingerprint';

const MAX_TEXT_LENGTH = 200;
const MAX_SETTINGS = 64;
const MAX_SETTING_VALUE_LENGTH = 64;
const SETTING_CODE = /^\$\d{1,4}$/;
const TEXT_FIELDS = ['firmwareVersion', 'buildInfo', 'buildOptions'] as const;

/** A recorded controller read back from storage, or null when it is malformed.
 * The caller keeps the machine and forgets only the recording: it can be
 * recorded again from the next connection. */
export function parseControllerFingerprint(value: unknown): ControllerFingerprint | null {
  if (!isRecord(value)) return null;
  const firmware = value['firmware'];
  if (firmware !== undefined && !isKnownControllerKind(firmware)) return null;
  const text = textFields(value);
  const usb = usbFields(value);
  const settings = settingsField(value['settings']);
  if (text === null || usb === null || settings === null) return null;
  return {
    ...(firmware === undefined ? {} : { firmware }),
    ...text,
    ...usb,
    ...(settings === undefined ? {} : { settings }),
  };
}

function textFields(value: Record<string, unknown>): Partial<ControllerFingerprint> | null {
  const fields: Partial<Record<(typeof TEXT_FIELDS)[number], string>> = {};
  for (const key of TEXT_FIELDS) {
    const text = value[key];
    if (text === undefined) continue;
    if (!isBoundedText(text, MAX_TEXT_LENGTH)) return null;
    fields[key] = text;
  }
  return fields;
}

function usbFields(value: Record<string, unknown>): Partial<ControllerFingerprint> | null {
  const vendor = value['usbVendorId'];
  const product = value['usbProductId'];
  if (vendor === undefined && product === undefined) return {};
  if (!isUsbId(vendor) || !isUsbId(product)) return null;
  return { usbVendorId: vendor, usbProductId: product };
}

function settingsField(value: unknown): Readonly<Record<string, string>> | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_SETTINGS) return null;
  const settings: Record<string, string> = {};
  for (const [code, setting] of entries) {
    if (!SETTING_CODE.test(code) || !isBoundedText(setting, MAX_SETTING_VALUE_LENGTH)) return null;
    settings[code] = setting;
  }
  return settings;
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= maxLength;
}

function isUsbId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
