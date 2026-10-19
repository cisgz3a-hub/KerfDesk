// use-board-pointer — the positioning light during board capture (ADR-636).
// Machines with a separate red dot / crosshair (Machine Setup → Positioning
// light) get it switched on automatically while the operator captures corners,
// and off again once the board is created or the panel closes — but only a
// light this hook switched on, so a light the operator turned on stays on.
//
// Switching goes through the ordinary positioning-light transaction (fresh
// Idle check, beam-off lines, then the light's own command); this hook only
// decides when. It waits for the controller to be free rather than queueing,
// tries automatically once per capture, and never fires the cutting beam.

import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { Vec2 } from '../../../core/scene';
import { useStore } from '../../state';
import { useLaserStore, type LaserState } from '../../state/laser-store';
import { jogFrameCommandBlockMessage } from '../../state/laser-store-helpers';
import { pendingTransportWriteCount } from '../../state/laser-start-queue-fence';
import { boardPointerConfigured, boardPointerOffsetMm } from './board-sight';

const AUTO_POINTER_STORAGE_KEY = 'kerfdesk.placeBoard.autoPointer';

type BoardPointerPreference = {
  readonly autoPointer: boolean;
  readonly setAutoPointer: (autoPointer: boolean) => void;
};

export const useBoardPointerPreference = create<BoardPointerPreference>((set) => ({
  autoPointer: readAutoPointer(),
  setAutoPointer: (autoPointer) => {
    writeAutoPointer(autoPointer);
    set({ autoPointer });
  },
}));

export type BoardPointer = {
  /** The profile has a usable separate positioning light. */
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly switching: boolean;
  readonly offset: Vec2;
  readonly auto: boolean;
  readonly error: string | null;
  readonly setAuto: (auto: boolean) => void;
  readonly toggle: () => void;
};

export function useBoardPointer(active: boolean): BoardPointer {
  const device = useStore((state) => state.project.device);
  const configured = boardPointerConfigured(device);
  const enabled = useLaserStore((state) => state.positioningLightEnabled);
  const auto = useBoardPointerPreference((state) => state.autoPointer);
  const setAuto = useBoardPointerPreference((state) => state.setAutoPointer);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `owned`: this hook switched the light on. `tried`: the automatic attempt
  // for the current capture has run, so a failure is not retried in a loop.
  const owned = useRef(false);
  const tried = useRef(false);
  const busy = useRef(false);
  // Watch for a free controller only while there is a switch to make: the
  // panel is always mounted, and must not re-render as a job streams.
  const pending = active
    ? auto && configured && !enabled && !tried.current
    : owned.current && enabled;
  const ready = useLaserStore((state) => pending && pointerSwitchReady(state));

  const run = (on: boolean, automatic: boolean): void => {
    if (busy.current) return;
    busy.current = true;
    setSwitching(true);
    setError(null);
    const laser = useLaserStore.getState();
    const action = on ? laser.switchPositioningLightOn : laser.switchPositioningLightOff;
    void action()
      .then(() => {
        owned.current = on && automatic;
      })
      .catch((cause: unknown) => {
        setError(
          `${on ? 'Could not switch the pointer on' : 'Could not switch the pointer off'}: ${errorMessage(cause)}`,
        );
      })
      .finally(() => {
        busy.current = false;
        setSwitching(false);
      });
  };

  useEffect(() => {
    if (!enabled) owned.current = false;
  }, [enabled]);

  useEffect(() => {
    if (!active) {
      tried.current = false;
      if (owned.current && enabled && ready) run(false, true);
      return;
    }
    if (!auto || !configured || enabled || tried.current || !ready) return;
    tried.current = true;
    run(true, true);
    // run is recreated every render; the inputs that matter are listed.
  }, [active, auto, configured, enabled, ready]);

  return {
    configured,
    enabled,
    switching,
    offset: configured ? boardPointerOffsetMm(device) : { x: 0, y: 0 },
    auto,
    error,
    setAuto,
    toggle: () => {
      // A manual switch takes the light away from the automation's ownership.
      owned.current = false;
      run(!enabled, false);
    },
  };
}

/** The controller can take a positioning-light exchange right now. */
export function pointerSwitchReady(state: LaserState): boolean {
  return (
    state.connection.kind === 'connected' &&
    jogFrameCommandBlockMessage(state) === null &&
    !state.autofocusBusy &&
    !state.probeBusy &&
    state.pendingUntrackedAcks === 0 &&
    pendingTransportWriteCount(state) === 0
  );
}

function readAutoPointer(): boolean {
  try {
    return globalThis.localStorage?.getItem(AUTO_POINTER_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeAutoPointer(autoPointer: boolean): void {
  try {
    globalThis.localStorage?.setItem(AUTO_POINTER_STORAGE_KEY, autoPointer ? 'on' : 'off');
  } catch {
    // A blocked store only means the choice is not remembered next time.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
}
