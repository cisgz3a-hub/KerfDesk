// One layer's LMC settings, in MeerK40t's set_settings order (balormk/
// controller.py L643-708 at d511944e): the MOPA pulse width, the jump speed,
// the source's frequency and power words (L937-989), the mark speed, then the
// laser-on, laser-off and polygon delays. Each word is written only when it
// changes. MeerK40t keeps a CO2/UV power word when only the frequency changes,
// although its ratio depends on the frequency; this build writes it again
// whenever its word differs (ADR-704).

import type { GalvoSetup } from '../../devices/galvo-setup';
import {
  LIST_FIBER_YLPM_PULSE_WIDTH,
  LIST_MARK_CURRENT,
  LIST_MARK_FREQ,
  LIST_MARK_POWER_RATIO,
  LIST_QSWITCH_PERIOD,
  LIST_SET_CO2_FPK,
} from './lmc-opcodes';
import type { LmcProgramWriter } from './lmc-program-writer';
import {
  lmcFirstPulseKillerWord,
  lmcMarkCurrentWord,
  lmcPeriodWord,
  lmcPowerRatioWord,
} from './lmc-units';

export type LmcLaserSettings = {
  readonly powerPercent: number;
  readonly frequencyKhz: number;
  readonly pulseWidthNs: number;
  readonly jumpSpeedWord: number;
  readonly markSpeedWord: number;
};

export function writeLmcLaserSettings(
  writer: LmcProgramWriter,
  setup: GalvoSetup,
  settings: LmcLaserSettings,
): void {
  // MeerK40t sends the pulse width only for a fiber with pulse width enabled:
  // this build's MOPA source (controller.py L650-661).
  if (setup.source === 'mopa')
    writer.setting(LIST_FIBER_YLPM_PULSE_WIDTH, Math.trunc(settings.pulseWidthNs));
  writer.jumpSpeed(settings.jumpSpeedWord);
  writeSourcePower(writer, setup.source, settings.powerPercent, settings.frequencyKhz);
  writer.markSpeed(settings.markSpeedWord);
  writer.laserOnDelay(setup.laserOnDelayUs);
  writer.laserOffDelay(setup.laserOffDelayUs);
  writer.polygonDelay(setup.polygonDelayUs);
}

function writeSourcePower(
  writer: LmcProgramWriter,
  source: GalvoSetup['source'],
  powerPercent: number,
  frequencyKhz: number,
): void {
  if (source === 'fiber' || source === 'mopa') {
    // Q-switch period from a 20000 base, then a 12-bit current (L967-968, L953-954).
    writer.setting(LIST_QSWITCH_PERIOD, lmcPeriodWord(frequencyKhz, 20000));
    writer.setting(LIST_MARK_CURRENT, lmcMarkCurrentWord(powerPercent));
    return;
  }
  // CO2 and UV: mark frequency from a 10000 base, the first-pulse killer, then
  // power as a ratio of the frequency (L969-974, L976-989, L948-961).
  writer.setting(LIST_MARK_FREQ, lmcPeriodWord(frequencyKhz, 10000));
  const fpk = lmcFirstPulseKillerWord(frequencyKhz);
  writer.setting(LIST_SET_CO2_FPK, fpk, fpk);
  writer.setting(LIST_MARK_POWER_RATIO, lmcPowerRatioWord(powerPercent, frequencyKhz));
}
