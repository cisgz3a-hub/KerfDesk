// ADR-704: the Galvo fields of Cut Settings, read back into the operation.
// Only a form that showed them changes them; a blank box is the machine's
// default, written as no key, so a layer never set keeps exactly its keys.

import {
  GALVO_FREQUENCY_MAX_KHZ,
  GALVO_FREQUENCY_MIN_KHZ,
  isGalvoPulseWidthNs,
} from '../../core/devices/galvo-setup';
import type { Layer } from '../../core/scene';
import { submittedNumber } from './cut-settings-number-field';

type GalvoPatch = Partial<Pick<Layer, 'galvoFrequencyKhz' | 'galvoPulseWidthNs'>>;

export function readGalvoPatch(data: FormData, layer: Layer): GalvoPatch {
  if (!data.has('galvoShown')) return {};
  const frequency = readFrequency(data, layer.galvoFrequencyKhz);
  const pulseWidth = data.has('galvoPulseWidthNs')
    ? readPulseWidth(data, layer.galvoPulseWidthNs)
    : layer.galvoPulseWidthNs;
  return {
    ...(frequency === layer.galvoFrequencyKhz ? {} : { galvoFrequencyKhz: frequency }),
    ...(pulseWidth === layer.galvoPulseWidthNs ? {} : { galvoPulseWidthNs: pulseWidth }),
  };
}

function readFrequency(data: FormData, stored: number | undefined): number | undefined {
  if (String(data.get('galvoFrequencyKhz') ?? '').trim() === '') return undefined;
  const parsed = submittedNumber(data, 'galvoFrequencyKhz');
  if (!Number.isFinite(parsed)) return stored;
  if (parsed === stored) return stored;
  return Math.max(GALVO_FREQUENCY_MIN_KHZ, Math.min(GALVO_FREQUENCY_MAX_KHZ, parsed));
}

function readPulseWidth(data: FormData, stored: number | undefined): number | undefined {
  const raw = String(data.get('galvoPulseWidthNs') ?? '').trim();
  if (raw === '') return undefined;
  const parsed = Number(raw);
  return isGalvoPulseWidthNs(parsed) ? parsed : stored;
}
