// JogPad - directional jog grid. F-B5.
//
// Click a jog arrow for one selected step. Holding a pointer arrow starts a
// continuous jog; release, pointer loss, blur, and unmount all route through the
// controller's jog-cancel command. Bare arrow keys nudge the selected canvas
// object and no longer jog the machine (F104); Z-focus keys stay on the pad.

import { useCallback, useMemo, useState } from 'react';
import { jogAxisSignsForOrigin } from '../../core/devices';
import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import { inferCurrentMachinePosition } from '../state/infer-machine-position';
import { useLaserStore } from '../state/laser-store';
import { FocusJogControls, focusJogReady } from './FocusJogControls';
import { JogArrowGrid } from './JogArrowGrid';
import { JogPadAirAssist } from './JogPadAirAssist';
import { JogSettingsRow } from './JogSettingsRow';
import { MomentaryFireControl } from './MomentaryFireControl';
import { clampJogFeed, type JogVector } from './jog-control-policy';
import { useJogControlPreferences } from './jog-control-preferences';
import { useJogShortcuts } from './use-jog-shortcuts';
import { useZeroZAction } from './use-zero-z-action';

const FOCUS_FEED_MM_PER_MIN = 600;

export function JogPad({ disabled }: { readonly disabled: boolean }): JSX.Element {
  const [focusStep, setFocusStep] = useState<number>(1);
  const step = useJogControlPreferences((state) => state.stepMm);
  const setStep = useJogControlPreferences((state) => state.setStepMm);
  const selectedFeed = useJogControlPreferences((state) => state.requestedFeedMmPerMin);
  const setSelectedFeed = useJogControlPreferences((state) => state.setRequestedFeedMmPerMin);
  const project = useStore((s) => s.project);
  const device = project.device;
  const machineKind = machineKindOf(project.machine);
  const maxFeed = device.maxFeed;
  const jog = useLaserStore((s) => s.jog);
  const cancelJog = useLaserStore((s) => s.cancelJog);
  const continuousJogSupported = useLaserStore((s) => s.capabilities.jogCancel);
  const statusReport = useLaserStore((s) => s.statusReport);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const feed = clampJogFeed(selectedFeed, maxFeed);
  const focusFeed = Math.min(maxFeed, FOCUS_FEED_MM_PER_MIN);
  const signs = useMemo(() => jogAxisSignsForOrigin(device.origin), [device.origin]);
  const position = inferCurrentMachinePosition(statusReport, wcoCache);
  const focusReady = focusJogReady(device, machineKind);

  const sendVector = useCallback(
    (vector: JogVector): void => {
      void jog(vector).catch(() => undefined);
    },
    [jog],
  );
  const sendFocus = useCallback(
    (direction: 1 | -1): void => {
      void jog({ dz: direction * focusStep, feed: focusFeed }).catch(() => undefined);
    },
    [focusFeed, focusStep, jog],
  );
  const cancelContinuousJog = useCallback((): void => {
    void cancelJog().catch(() => undefined);
  }, [cancelJog]);
  const handleZeroZ = useZeroZAction();

  useJogPadShortcuts(disabled, focusReady, sendFocus);

  return (
    <div style={containerStyle}>
      <JogSettingsRow
        disabled={disabled}
        step={step}
        feed={feed}
        maxFeed={maxFeed}
        onStep={setStep}
        onFeed={setSelectedFeed}
      />
      <div style={jogRowStyle}>
        <JogArrowGrid
          disabled={disabled}
          stepMm={step}
          feed={feed}
          signs={signs}
          position={position}
          bed={{ width: device.bedWidth, height: device.bedHeight }}
          continuousJogSupported={continuousJogSupported}
          onJog={sendVector}
          onCancel={cancelContinuousJog}
        />
        <JogPadAirAssist />
        <MomentaryFireControl />
      </div>
      <FocusJogControls
        device={device}
        machineKind={machineKind}
        disabled={disabled}
        focusStep={focusStep}
        setFocusStep={setFocusStep}
        onJog={sendFocus}
        onZeroZ={handleZeroZ}
      />
    </div>
  );
}

function useJogPadShortcuts(
  disabled: boolean,
  focusReady: boolean,
  onFocusJog: (direction: 1 | -1) => void,
): void {
  useJogShortcuts({ focusDisabled: disabled || !focusReady, onFocusJog });
}

const containerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const jogRowStyle: React.CSSProperties = {
  display: 'grid',
  // The Fire/air-assist column shrinks (minmax floor 0) rather than overflowing
  // the fixed-width rail when the panel is dragged toward its minimum width; the
  // arrow pad keeps its 116px min so the jog buttons never clip.
  gridTemplateColumns: 'minmax(116px, 1fr) minmax(0, 104px)',
  gridTemplateAreas: '"arrows air" "warning warning"',
  alignItems: 'stretch',
  gap: 8,
};
