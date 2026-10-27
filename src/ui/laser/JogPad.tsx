// JogPad - directional jog grid. F-B5.
//
// Click a jog arrow for one selected step. Holding a pointer arrow starts a
// continuous jog; release, pointer loss, blur, and unmount all route through the
// controller's jog-cancel command. Bare arrow keys nudge the selected canvas
// object and no longer jog the machine (F104). The pad owns the keyboard jog
// keys while it is mounted: PageUp/PageDown for Z focus, and LightBurn's XY
// keys (ADR-493), which send the same step vector as the matching arrow.
// While a step jog runs on a GRBL-family controller the arrows and XY keys stay
// live for more steps, which join that jog (stepJogsOnly, ADR-674); hold, Z
// focus and the settings rows wait for it to finish.

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { jogAxisSignsForOrigin, type JogAxisSigns } from '../../core/devices';
import { deviceForActiveHead } from '../../core/cnc/cnc-head-feeds';
import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import { runningJobMachineKind } from '../state/job-motion-machine';
import { useLaserStore } from '../state/laser-store';
import { selectNativeBedEvidence } from '../state/native-bed-frame';
import { FocusJogControls, focusJogReady } from './FocusJogControls';
import { CentreSelectionButton } from './CentreSelectionButton';
import { JogArrowGrid } from './JogArrowGrid';
import { JogPadAirAssist } from './JogPadAirAssist';
import { JogSettingsRow } from './JogSettingsRow';
import { MomentaryFireControl } from './MomentaryFireControl';
import { clampJogFeed, type JogVector } from './jog-control-policy';
import { holdJogAim } from './jog-hold-aim';
import { useJogControlPreferences } from './jog-control-preferences';
import { controllerActionFailureHandler } from './report-controller-action-failure';
import { useJogShortcuts } from './use-jog-shortcuts';
import { useZeroZAction } from './use-zero-z-action';

const FOCUS_FEED_MM_PER_MIN = 600;
const QUEUE_STEP = { queueStep: true } as const;

type Props = {
  readonly disabled: boolean;
  /** With `disabled`: XY step presses may still join the running step jog. */
  readonly stepJogsOnly?: boolean;
  readonly machineHome?: ReactNode;
  readonly machineActions?: ReactNode;
};

export function JogPad({
  disabled,
  stepJogsOnly = false,
  machineHome,
  machineActions,
}: Props): JSX.Element {
  const arrowsDisabled = disabled && !stepJogsOnly;
  const [focusStep, setFocusStep] = useState<number>(1);
  const step = useJogControlPreferences((state) => state.stepMm);
  const setStep = useJogControlPreferences((state) => state.setStepMm);
  const selectedFeed = useJogControlPreferences((state) => state.requestedFeedMmPerMin);
  const setSelectedFeed = useJogControlPreferences((state) => state.setRequestedFeedMmPerMin);
  const project = useStore((s) => s.project);
  const device = project.device;
  // A running job's own kind decides Z jog and Zero Z (ADR-416 Amendment 3).
  const runningKind = useLaserStore((s) => runningJobMachineKind(s));
  const machineKind = runningKind ?? machineKindOf(project.machine);
  const maxFeed = deviceForActiveHead(device, project.machine).maxFeed;
  const continuousJogSupported = useLaserStore((s) => s.capabilities.jogCancel);
  const feed = clampJogFeed(selectedFeed, maxFeed);
  const focusFeed = Math.min(maxFeed, FOCUS_FEED_MM_PER_MIN);
  const signs = useMemo(() => jogAxisSignsForOrigin(device.origin), [device.origin]);
  const focusReady = focusJogReady(device, machineKind);
  // Manual Air sends the laser profile's air output (M7/M8), which on a router
  // is a coolant relay. CNC keeps the button only to switch off air that was
  // left on from Laser mode.
  const airAssistOn = useLaserStore((s) => s.airAssistOn);
  const showManualAir = machineKind === 'laser' || airAssistOn;

  const { sendVector, sendFocus, cancelContinuousJog } = useJogSenders(focusStep, focusFeed);
  const handleZeroZ = useZeroZAction();

  useJogPadShortcuts({
    disabled,
    xyDisabled: arrowsDisabled,
    focusReady,
    sendFocus,
    sendVector,
    step,
    feed,
    signs,
  });

  return (
    <div className="lf-jog-panel" style={containerStyle}>
      <div className="lf-machine-section-heading">Position the head</div>
      <JogControlsLayout
        showManualAir={showManualAir}
        machineKind={machineKind}
        machineActions={machineActions}
      >
        <JogArrows
          centerAction={machineHome}
          disabled={arrowsDisabled}
          stepMm={step}
          feed={feed}
          signs={signs}
          continuousJogSupported={continuousJogSupported && !stepJogsOnly}
          onJog={sendVector}
          onCancel={cancelContinuousJog}
        />
      </JogControlsLayout>
      <CentreSelectionButton disabled={disabled} />
      <JogSettingsRow
        disabled={disabled}
        step={step}
        feed={feed}
        maxFeed={maxFeed}
        onStep={setStep}
        onFeed={setSelectedFeed}
      />
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

// A step press may join a running step jog (ADR-674); a hold never does.
function useJogSenders(
  focusStep: number,
  focusFeed: number,
): {
  readonly sendVector: (vector: JogVector, mode?: 'step' | 'hold') => void;
  readonly sendFocus: (direction: 1 | -1) => void;
  readonly cancelContinuousJog: () => void;
} {
  const jog = useLaserStore((s) => s.jog);
  const cancelJog = useLaserStore((s) => s.cancelJog);
  const sendVector = useCallback(
    (vector: JogVector, mode: 'step' | 'hold' = 'step'): void => {
      const sent = mode === 'step' ? jog(vector, undefined, QUEUE_STEP) : jog(vector);
      void sent.catch(controllerActionFailureHandler('Jog'));
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
  return { sendVector, sendFocus, cancelContinuousJog };
}

function JogControlsLayout(props: {
  readonly showManualAir: boolean;
  readonly machineKind: 'laser' | 'cnc';
  readonly machineActions: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  const integrated = props.machineActions !== undefined;
  return (
    <div
      className={`lf-jog-controls${integrated ? ' lf-jog-controls--machine-actions' : ''}`}
      style={
        integrated
          ? {
              ...jogRowStyle,
              gridTemplateAreas: machineActionAreas(props.showManualAir, props.machineKind),
              // LaserWindow.css spaces these rows with margins, so the Fire and
              // warning rows take no height while they are empty.
              rowGap: 0,
            }
          : jogRowStyle
      }
    >
      {props.children}
      {props.showManualAir ? <JogPadAirAssist compact={integrated} /> : null}
      {props.machineActions}
      <MomentaryFireControl />
    </div>
  );
}

function machineActionAreas(showManualAir: boolean, machineKind: 'laser' | 'cnc'): string {
  return [
    ...(showManualAir ? ['"arrows air"'] : []),
    ...(machineKind === 'laser' ? ['"arrows autofocus"'] : []),
    '"arrows origin"',
    '"fire fire"',
    '"warning warning"',
  ].join(' ');
}

// The head position only aims a continuous jog. A disabled pad (a job, Frame or
// another motion owns the machine) cannot start one, so it does not follow the
// status report either; before, the whole jog panel re-rendered on every poll
// of a running job (ADR-352). The hold aims inside the controller's travel
// envelope (jog-hold-aim.ts), as the phone's hold does.
function JogArrows(
  props: Omit<Parameters<typeof JogArrowGrid>[0], 'position' | 'bounds'>,
): JSX.Element {
  const statusReport = useLaserStore((s) => (props.disabled ? null : s.statusReport));
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const reportInches = useLaserStore((s) => s.controllerSettings?.reportInches === true);
  const evidence = useLaserStore(selectNativeBedEvidence);
  const device = useStore((s) => s.project.device);
  const aim = holdJogAim({ device, evidence, statusReport, wcoCache, reportInches });
  return <JogArrowGrid {...props} bounds={aim.bounds} position={aim.position} />;
}

// Keyboard jog is live only while the pad is mounted. An XY key sends the pad's
// own step vector (ADR-493), so it is disabled exactly when the arrows are.
function useJogPadShortcuts(pad: {
  readonly disabled: boolean;
  readonly xyDisabled: boolean;
  readonly focusReady: boolean;
  readonly sendFocus: (direction: 1 | -1) => void;
  readonly sendVector: (vector: JogVector) => void;
  readonly step: number;
  readonly feed: number;
  readonly signs: JogAxisSigns;
}): void {
  useJogShortcuts({
    focusDisabled: pad.disabled || !pad.focusReady,
    onFocusJog: pad.sendFocus,
    xyDisabled: pad.xyDisabled,
    xyStep: { stepMm: pad.step, feed: pad.feed, signs: pad.signs },
    onXyJog: pad.sendVector,
  });
}

const containerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const jogRowStyle: React.CSSProperties = {
  display: 'grid',
  // The Fire/air-assist column shrinks (minmax floor 0) rather than overflowing
  // the fixed-width rail when the panel is dragged toward its minimum width; the
  // arrow pad keeps its own width as the floor so the jog buttons never clip.
  // At full rail width the column is wide enough for one-line action labels.
  gridTemplateColumns: 'minmax(min-content, 1fr) minmax(0, 128px)',
  gridTemplateAreas: '"arrows air" "arrows fire" "warning warning"',
  alignItems: 'stretch',
  gap: 6,
};
