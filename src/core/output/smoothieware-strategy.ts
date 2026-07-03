// Smoothieware output strategy (ADR-096). Smoothie's laser module scales S
// against `laser_module_maximum_s_value`, which defaults to 1.0 — power is a
// FRACTION. The GRBL emitter rounds S to integers (right for S 0–1000, fatal
// for S 0–1.0: everything becomes 0 or 1), so this strategy emits against a
// high-resolution virtual scale and rescales every S word to the profile's
// real maximum, keeping non-negotiable #7 honest at fractional scales.

import type { DeviceProfile } from '../devices';
import type { Job } from '../job';
import { grblStrategy } from './grbl-strategy';

const VIRTUAL_MAX_S = 1000;
const S_WORD_RE = /\bS(\d+(?:\.\d+)?)/g;

export const smoothiewareStrategy = {
  id: 'smoothieware' as const,
  emit: (job: Job, device: DeviceProfile): string => {
    const body = grblStrategy.emit(job, { ...device, maxPowerS: VIRTUAL_MAX_S });
    return rescaleSWords(body, device.maxPowerS);
  },
};

function rescaleSWords(body: string, maxPowerS: number): string {
  return body.replace(S_WORD_RE, (_match, sText: string) => {
    const virtual = Number.parseFloat(sText);
    if (!Number.isFinite(virtual) || virtual <= 0) return 'S0';
    return `S${formatPower((virtual / VIRTUAL_MAX_S) * maxPowerS)}`;
  });
}

function formatPower(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
