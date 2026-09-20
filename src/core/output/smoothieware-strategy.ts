// Smoothieware output strategy (ADR-096). Smoothie's laser module scales S
// against `laser_module_maximum_s_value`, which defaults to 1.0 — power is a
// FRACTION. The GRBL emitter rounds S to integers (right for S 0–1000, fatal
// for S 0–1.0: everything becomes 0 or 1), so this strategy emits against a
// high-resolution virtual scale and rescales every S word to the profile's
// real maximum, keeping non-negotiable #7 honest at fractional scales.

import type { DeviceProfile } from '../devices';
import type { Job } from '../job';
import { grblStrategy } from './grbl-strategy';
import { SMOOTHIE_VIRTUAL_MAX_POWER } from '../raster/controller-power-scale';
import { rescaleRasterJob } from './rescale-raster-job';
import { SMOOTHIE_CMD_FIRE_OFF } from '../controllers/smoothieware/commands';
import type { OutputEmitOptions } from './output-strategy';

const S_WORD_RE = /\bS(\d+(?:\.\d+)?)/g;

export const smoothiewareStrategy = {
  id: 'smoothieware' as const,
  emit: (job: Job, device: DeviceProfile, options: OutputEmitOptions = {}): string => {
    const body = grblStrategy.emit(
      rescaleRasterJob(job, device.maxPowerS, SMOOTHIE_VIRTUAL_MAX_POWER),
      { ...device, maxPowerS: SMOOTHIE_VIRTUAL_MAX_POWER },
      // `rescaleSWords` below rewrites every S word by regex, so the body must
      // arrive in the verbose spelling (ADR-332).
      { ...options, compactMotionWords: false },
    );
    return `${SMOOTHIE_CMD_FIRE_OFF}\n${nativePowerModes(rescaleSWords(body, device.maxPowerS))}`;
  },
};

function rescaleSWords(body: string, maxPowerS: number): string {
  return body.replace(S_WORD_RE, (_match, sText: string) => {
    const virtual = Number.parseFloat(sText);
    if (!Number.isFinite(virtual) || virtual <= 0) return 'S0';
    return `S${formatPower((virtual / SMOOTHIE_VIRTUAL_MAX_POWER) * maxPowerS)}`;
  });
}

function formatPower(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0{1,3}$/, '');
}

/** The native Laser module uses motion S values, not GRBL M3/M4 selection.
 * M221 P1 disables proportional scaling; P0 enables it. These changes execute
 * immediately, so settle old blocks before switching modes or disabling power.
 * M221 S is a percent override, and must never pass through S-unit rescaling.
 */
function nativePowerModes(body: string): string {
  return body
    .split('\n')
    .flatMap((line) => {
      if (/^M[34]\b/.test(line)) {
        return ['M400', `M221 S100 P${line.startsWith('M3') ? 1 : 0}`];
      }
      if (/^M5\b/.test(line)) return ['M400', 'M221 S0'];
      return [line];
    })
    .join('\n');
}
