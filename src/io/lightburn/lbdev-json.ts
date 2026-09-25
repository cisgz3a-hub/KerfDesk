// LightBurn's device files are JSON (2026-09-25 controller audit, OR-5):
//   {"DeviceList": [{"DisplayName": "xTool D1 Pro", "Name": "GRBL",
//     "Width": 430, "Height": 400, "MirrorX": false, "MirrorY": true,
//     "Settings": {"S_Scale": 1000, "BaudRate": 230400, "AirAssistM7": false,
//                  "EnableGrblJCommand": false, "StartGCode": "...", ...}}]}
// xTool's D1 Pro file and Creality's Falcon A1 Pro bundle use these keys.
// `Name` is LightBurn's device driver (GRBL, GRBL-LPC, GRBL-M3, Ruida, ...);
// `DisplayName` is the operator's name for the machine. MirrorX puts the
// origin on the right and MirrorY at the rear, as LightBurn's Origin setting
// stores them.

import type { Origin } from '../../core/devices';
import {
  parsePositiveNumber,
  type LightBurnDeviceParse,
  type ParsedLightBurnDevice,
} from './lbdev-device';

type JsonRecord = Readonly<Record<string, unknown>>;

const ORIGIN_BY_MIRROR: Readonly<Record<string, Origin>> = {
  'false,false': 'front-left',
  'true,false': 'front-right',
  'false,true': 'rear-left',
  'true,true': 'rear-right',
};

/** The JSON device form; null when the text is not JSON (the legacy XML form). */
export function parseLightBurnJsonDevice(text: string): LightBurnDeviceParse | null {
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  if (!trimmed.startsWith('{')) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { kind: 'invalid', reason: 'not a readable LightBurn device file' };
  }
  const list = isRecord(value) ? value['DeviceList'] : undefined;
  if (!Array.isArray(list) || !isRecord(list[0])) {
    return { kind: 'invalid', reason: 'no device in the LightBurn DeviceList' };
  }
  return jsonDevice(list[0], list.length);
}

function jsonDevice(entry: JsonRecord, deviceCount: number): LightBurnDeviceParse {
  const width = positive(entry['Width']);
  const height = positive(entry['Height']);
  if (width === null || height === null) {
    return { kind: 'invalid', reason: 'missing bed width or height' };
  }
  const settings = settingsOf(entry);
  const controller = textOf(entry['Name']);
  const mirror = mirrorOrigin(entry);
  const device: ParsedLightBurnDevice = {
    name: textOf(entry['DisplayName']) ?? controller ?? 'Imported LightBurn device',
    ...(controller === undefined ? {} : { controller }),
    width,
    height,
    ...(mirror === null ? {} : { originRaw: mirror.raw }),
    origin: mirror?.origin ?? null,
    maxPowerS: positive(settings['S_Scale']),
    ...settingsFields(settings),
    ...(deviceCount > 1 ? { deviceCount } : {}),
    isGrbl: controller?.toLowerCase().includes('grbl') === true,
  };
  return { kind: 'ok', device };
}

function settingsFields(settings: JsonRecord): Partial<ParsedLightBurnDevice> {
  const baudRate = positive(settings['BaudRate']);
  const air = settings['AirAssistM7'];
  const startScript = textOf(settings['StartGCode']);
  const endScript = textOf(settings['EndGCode']);
  return {
    ...(baudRate === null || !Number.isInteger(baudRate) ? {} : { baudRate }),
    ...(typeof air === 'boolean' ? { airAssistCommand: air ? 'M7' : 'M8' } : {}),
    ...(settings['EnableGrblJCommand'] === false ? { jogCommandDisabled: true } : {}),
    ...(startScript === undefined ? {} : { startScript }),
    ...(endScript === undefined ? {} : { endScript }),
  };
}

function mirrorOrigin(entry: JsonRecord): { readonly raw: string; readonly origin: Origin } | null {
  const mirrorX = entry['MirrorX'];
  const mirrorY = entry['MirrorY'];
  if (typeof mirrorX !== 'boolean' && typeof mirrorY !== 'boolean') return null;
  const right = mirrorX === true;
  const rear = mirrorY === true;
  return {
    raw: `MirrorX ${right ? 'on' : 'off'}, MirrorY ${rear ? 'on' : 'off'}`,
    origin: ORIGIN_BY_MIRROR[`${right},${rear}`] ?? 'front-left',
  };
}

function settingsOf(entry: JsonRecord): JsonRecord {
  const settings = entry['Settings'] ?? entry['settings'];
  return isRecord(settings) ? settings : {};
}

function positive(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  return typeof value === 'string' ? parsePositiveNumber(value) : null;
}

function textOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
