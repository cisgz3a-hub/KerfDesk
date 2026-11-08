// The question for a CNC machine that KerfDesk 1.0.29 may have made from a
// laser (rolling audit v10 V2-P2-2, ADR-637 Amendment 8): asked in Machine
// Setup, on the canvas banner and in Job Review, whose Start waits for it.
// The machine type is never changed without the operator: "It's a laser"
// opens Machine Setup on Laser, and only Save applies it. "This is a CNC
// router" is kept here, app-level beside the last machine, so it is asked
// once. Reads and writes fail soft: without storage the answer lasts the
// session.

import { create } from 'zustand';
import type { GrblBuildInfo } from '../../core/controllers/grbl/build-info';
import type { DeviceProfile } from '../../core/devices';
import {
  convertedLaserSuspicion,
  type ConvertedLaserHint,
  type ConvertedLaserSuspicion,
} from '../../core/preflight/converted-laser-profile';
import type { MachineConfig } from '../../core/scene';
import { browserLocalStorage } from './browser-local-storage';

export const CONVERTED_LASER_ANSWER_STORAGE_KEY = 'kerfdesk.converted-laser-answer.v1';
const ROUTER_ANSWER = 'cnc-router';

export const CONVERTED_LASER_HEADING = 'Is this machine a laser?';

export const CONVERTED_LASER_RISK =
  'KerfDesk 1.0.29 could set a laser up as a CNC when its controller had laser mode off ($32=0). Set up as a CNC, a job turns the laser on at full power, holds it still for 3 seconds, and keeps it on over every travel move.';

export const CONVERTED_LASER_START_TITLE =
  'Answer whether this machine is a laser before starting.';

type ConvertedLaserAnswerState = {
  readonly routerAnswered: boolean;
  readonly answerRouter: () => void;
};

export const useConvertedLaserAnswerStore = create<ConvertedLaserAnswerState>((set) => ({
  routerAnswered: readRouterAnswer(),
  answerRouter: () => {
    const storage = browserLocalStorage();
    try {
      storage?.setItem(CONVERTED_LASER_ANSWER_STORAGE_KEY, ROUTER_ANSWER);
    } catch {
      // The answer still holds for this session.
    }
    set({ routerAnswered: true });
  },
}));

function readRouterAnswer(): boolean {
  try {
    return browserLocalStorage()?.getItem(CONVERTED_LASER_ANSWER_STORAGE_KEY) === ROUTER_ANSWER;
  } catch {
    return false;
  }
}

/** The live controller facts the question reads: settings and build info
 *  from this session's reads, when there were any. */
export type ConvertedLaserControllerState = {
  readonly detectedSettings: Partial<DeviceProfile> | null;
  readonly controllerBuildInfo?: GrblBuildInfo | null;
};

/** The question to ask for this machine, or null when there is none. */
export function convertedLaserQuestion(
  machine: { readonly device: DeviceProfile; readonly machine?: MachineConfig | undefined },
  controller: ConvertedLaserControllerState,
  routerAnswered: boolean = useConvertedLaserAnswerStore.getState().routerAnswered,
): ConvertedLaserSuspicion | null {
  if (routerAnswered) return null;
  const settings = controller.detectedSettings;
  const version = controller.controllerBuildInfo?.protocolVersion;
  return convertedLaserSuspicion({
    profile: machine.device,
    machine: machine.machine,
    controller:
      settings === null && version === undefined
        ? null
        : {
            ...(settings?.laserModeEnabled === undefined
              ? {}
              : { laserModeEnabled: settings.laserModeEnabled }),
            ...(settings?.maxPowerS === undefined ? {} : { maxPowerS: settings.maxPowerS }),
            ...(version === undefined ? {} : { protocolVersion: version }),
          },
  });
}

/** One sentence naming what the controller reported, or null before a read. */
export function convertedLaserHintSentence(suspicion: ConvertedLaserSuspicion): string | null {
  const parts = suspicion.hints.map(hintText);
  if (parts.length === 0) return null;
  const listed =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
  return `Your controller reports ${listed}.`;
}

function hintText(hint: ConvertedLaserHint): string {
  switch (hint.kind) {
    case 'laser-mode':
      return hint.enabled ? 'laser mode on ($32=1)' : 'laser mode off ($32=0)';
    case 'laser-power-scale':
      return `$30=${hint.maxPowerS} (the power scale lasers use)`;
    case 'grbl-1-1':
      return `GRBL ${hint.protocolVersion} (the firmware that has laser mode)`;
  }
}
