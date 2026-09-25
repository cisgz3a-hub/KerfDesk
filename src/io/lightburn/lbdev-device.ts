// The fields KerfDesk reads from a LightBurn device file, whichever form it
// came in: the JSON `DeviceList` LightBurn writes today (lbdev-json.ts) or the
// legacy XML form (lbdev-import.ts).

import type { AirAssistCommand, Origin } from '../../core/devices';

export type ParsedLightBurnDevice = {
  readonly name: string;
  readonly controller?: string;
  readonly width: number;
  readonly height: number;
  readonly originRaw?: string;
  readonly origin: Origin | null;
  readonly maxPowerS: number | null;
  readonly baudRate?: number;
  readonly airAssistCommand?: Exclude<AirAssistCommand, 'none'>;
  /** The file tells LightBurn not to jog this machine with `$J=`. */
  readonly jogCommandDisabled?: boolean;
  /** How many devices the file listed; the first one is imported. */
  readonly deviceCount?: number;
  readonly startScript?: string;
  readonly endScript?: string;
  readonly isGrbl: boolean;
};

export type LightBurnDeviceParse =
  | { readonly kind: 'ok'; readonly device: ParsedLightBurnDevice }
  | { readonly kind: 'invalid'; readonly reason: string };

export function parsePositiveNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /-?\d+(?:\.\d+)?/.exec(value);
  if (match === null) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
