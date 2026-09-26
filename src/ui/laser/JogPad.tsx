// JogPad - directional jog grid. F-B5.
//
// Click a jog arrow for one selected step. Holding a pointer arrow starts a
// continuous jog; release, pointer loss, blur, and unmount all route through the
// controller's jog-cancel command. Bare arrow keys nudge the selected canvas
// object and no longer jog the machine (F104); Z-focus keys stay on the pad.

import { useCallback, useMemo, useState } from 'react';
import {
  jogAxisSignsForOrigin,
  machineBoundsForDevice,
  type MachineBounds,
} from '../../core/devices';
import type { NativeXyBounds } from '../../core/devices/native-bed-frame';
import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import { inferCurrentMachinePosition } from '../state/infer-machine-position';
import { useLaserStore } from '../state/laser-store';
import { resolveNativeBedFrame, selectNativeBedEvidence } from '../state/native-bed-frame';
import { FocusJogControls, focusJogReady } from './FocusJogControls';
import { JogArrowGrid } from './JogArrowGrid';
import { JogPadAirAssist } from './JogPadAirAssist';
import { JogSettingsRow } from './JogSettingsRow';
import { MomentaryFireControl } from './MomentaryFireControl';
import { clampJogFeed, type JogVector } from './jog-control-policy';
import { useJogControlPreferences } from './jog-control-preferences';
import { controllerActionFailureHandler } from './report-controller-action-failure';
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
  const feed = clampJogFeed(selectedFeed, maxFeed);
  const focusFeed = Math.min(maxFeed, FOCUS_FEED_MM_PER_MIN);
  const signs = useMemo(() => jogAxisSignsForOrigin(device.origin), [device.origin]);
  const bounds = useMemo(() => machineBoundsForDevice(device), [device]);
  const focusReady = focusJogReady(device, machineKind);
  // Manual Air sends the laser profile's air output (M7/M8), which on a router
  // is a coolant relay. CNC keeps the button only to switch off air that was
  // left on from Laser mode.
  const airAssistOn = useLaserStore((s) => s.airAssistOn);
  const showManualAir = machineKind === 'laser' || airAssistOn;

  const sendVector = useCallback(
    (vector: JogVector): void => {
      void jog(vector).catch(controllerActionFailureHandler('Jog'));
    },
    [jog],
  );
  const sendFocus = useCallback(
    (direction: 1 | -1): void => {
      void jog({ dz: direction * focusStep, feed: focusFeed }).catch(
        controllerActionFailureHandler('Z jog'),
      );
    },
    [focusFeed, focusStep, jog],
  );
  const cancelContinuousJog = useCallback((): void => {
    void cancelJog().catch(controllerActionFailureHandler('Stop jog'));
  }, [cancelJog]);
  const handleZeroZ = useZeroZAction();

  useJogPadShortcuts(disabled, focusReady, sendFocus);

  return (
    <div className="lf-jog-panel" style={containerStyle}>
      <div className="lf-machine-section-heading">
        <span>Position the head</span>
      </div>
      <JogSettingsRow
        disabled={disabled}
        step={step}
        feed={feed}
        maxFeed={maxFeed}
        onStep={setStep}
        onFeed={setSelectedFeed}
      />
      <div className="lf-jog-controls" style={jogRowStyle}>
        <JogArrows
          disabled={disabled}
          stepMm={step}
          feed={feed}
          signs={signs}
          bounds={bounds}
          continuousJogSupported={continuousJogSupported}
          onJog={sendVector}
          onCancel={cancelContinuousJog}
        />
        {showManualAir ? <JogPadAirAssist /> : null}
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

// The head position only aims a continuous jog. A disabled pad (a job, Frame or
// another motion owns the machine) cannot start one, so it does not follow the
// status report either; before, the whole jog panel re-rendered on every poll
// of a running job (ADR-352).
//
// A hold jog runs to the travel edge, so it needs the controller's own travel
// envelope. MPos is in native machine coordinates, which match the profile bed
// only through a verified native frame: homed stock GRBL puts machine space
// into negative numbers, and a machine without homing starts at MPos 0,0
// wherever the head was at power-up. Clamping raw MPos against 0..bed made a
// held arrow do nothing toward the origin and overshoot the other way (audit
// jog-home-origin-3). Without a verified frame the hold asks for full travel
// and relies on release plus the jog-cancel byte, as it does with no position.
function JogArrows(props: Omit<Parameters<typeof JogArrowGrid>[0], 'position'>): JSX.Element {
  const statusReport = useLaserStore((s) => (props.disabled ? null : s.statusReport));
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const reportInches = useLaserStore((s) => s.controllerSettings?.reportInches === true);
  const nativeEvidence = useLaserStore(selectNativeBedEvidence);
  const device = useStore((s) => s.project.device);
  const nativeFrame = resolveNativeBedFrame(device, nativeEvidence);
  const position =
    nativeFrame === null ? null : inferCurrentMachinePosition(statusReport, wcoCache, reportInches);
  const bounds = nativeFrame === null ? props.bounds : nativeTravel(nativeFrame.nativeBounds);
  return <JogArrowGrid {...props} bounds={bounds} position={position} />;
}

function nativeTravel(bounds: NativeXyBounds): MachineBounds {
  return { ...bounds, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
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
  gridTemplateAreas: '"arrows air" "arrows fire" "warning warning"',
  alignItems: 'stretch',
  gap: 8,
};
