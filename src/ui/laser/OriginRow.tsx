// OriginRow — Set / Reset work origin (ADR-021) + Release motors (ADR-053 P4),
// extracted from JobControls.tsx when it hit the ADR-015 size cap.

import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { hasCustomOrigin, useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { clampJogFeed } from './jog-control-policy';
import { useJogControlPreferences } from './jog-control-preferences';
import { RELEASE_MOTORS_CONFIRM } from './hand-position-copy';

// ADR-053 P4 — releasing motors ($SLP) is hard to undo cleanly (waking needs a
// soft-reset that clears G92), so confirm and spell out the correct order:
// release -> hand-move -> Wake (Ctrl-X) -> Set origin LAST.
const SET_PERSISTENT_ORIGIN_CONFIRM =
  'Set persistent G54 origin?\n\n' +
  'This sends G10 L20 P1 X0 Y0 and writes the current head position into the controller. ' +
  'It survives reset and power-cycle until you clear the persistent G54 origin.';

const CLEAR_PERSISTENT_ORIGIN_CONFIRM =
  'Clear persistent G54 origin?\n\n' +
  'This sends G92.1, then G10 L2 P1 X0 Y0 to clear both transient and stored G54 origin offsets.';

// F.3 — Set / Reset the work-coordinate origin to the current head
// position. See ADR-021. Buttons:
//   - "Set origin here" sends G92 X0 Y0. Always enabled (subject to
//     `busy`) — the operator can re-set the origin whenever the head
//     is at a new corner.
//   - "Reset origin" sends G92.1. Only enabled when wcoCache shows a
//     non-trivial offset; disabled otherwise (nothing to clear).
//   - "Release motors" sends $SLP for hand-positioning (ADR-053 P4).
export function OriginRow(props: {
  readonly disabled: boolean;
  readonly streaming: boolean;
}): JSX.Element | null {
  const wcs = useLaserStore((s) => s.capabilities.wcs);
  const canSleep = useLaserStore((s) => s.capabilities.sleep);
  const homingEnabled = useStore((s) => s.project.device.homing.enabled);
  const setOrigin = useLaserStore((s) => s.setOriginHere);
  const resetOrigin = useLaserStore((s) => s.resetOrigin);
  const releaseMotors = useLaserStore((s) => s.releaseMotors);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const workOriginActive = useLaserStore((s) => s.workOriginActive);
  const workOriginSource = useLaserStore((s) => s.workOriginSource);
  const persistentOriginReady = useLaserStore((s) => s.statusReport?.state === 'Idle');
  const setJobPlacement = useStore((s) => s.setJobPlacement);
  const pushToast = useToastStore((s) => s.pushToast);
  const busy = props.disabled || props.streaming;
  // ADR-094: firmwares without work-coordinate-system support (Marlin v1)
  // have no origin vocabulary at all — the whole row disappears.
  if (wcs === 'none') return null;
  const hasCustom = workOriginActive || hasCustomOrigin(wcoCache);
  const persistentOrUnknown =
    workOriginSource === 'g54-persistent' || workOriginSource === 'unknown';
  const { onSet, onReset, onRelease } = makeOriginHandlers({
    setOrigin,
    resetOrigin,
    releaseMotors,
    setJobPlacement,
    pushToast,
  });
  return (
    <div style={originRowStyle}>
      <button
        type="button"
        onClick={onSet}
        disabled={busy}
        title="Declare the current head position as the workpiece (0, 0). Cleared on alarm or stop."
      >
        Set origin here
      </button>
      <button
        type="button"
        onClick={onReset}
        disabled={busy || !hasCustom || persistentOrUnknown}
        title={
          persistentOrUnknown
            ? 'This origin may be stored in G54. Use Clear persistent origin.'
            : hasCustom
              ? 'Clear the custom work origin (G92.1) — coordinates return to machine zero.'
              : 'No custom origin active. Set one with "Set origin here" first.'
        }
      >
        Reset origin
      </button>
      <GoToWorkZeroButton busy={busy} hasCustom={hasCustom} />
      {wcs === 'g92-and-g10' && (
        <AdvancedOriginControls
          busy={busy}
          hasCustom={hasCustom}
          persistentOriginReady={persistentOriginReady}
        />
      )}
      {canSleep && homingEnabled && (
        <button
          type="button"
          onClick={onRelease}
          disabled={busy}
          title="Release the motors ($SLP) so you can move the head by hand. Clears the work origin; Wake and Set origin again afterward."
        >
          Release motors
        </button>
      )}
    </div>
  );
}

type OriginHandlerDeps = {
  readonly setOrigin: () => Promise<void>;
  readonly resetOrigin: () => Promise<void>;
  readonly releaseMotors: () => Promise<void>;
  readonly setJobPlacement: (placement: { readonly startFrom: 'user-origin' }) => void;
  readonly pushToast: (message: string, variant: 'success') => void;
};

// Toast on ack covers the WCO-frame latency gap — GRBL reports WCO
// intermittently (every Nth status per `$10`), so the StatusDisplay readout
// may take 1-30 frames (~0.25-7.5s) to update after a G92. The toast gives
// instant feedback so the user doesn't re-click.
function makeOriginHandlers(deps: OriginHandlerDeps): {
  readonly onSet: () => void;
  readonly onReset: () => void;
  readonly onRelease: () => void;
} {
  return {
    onSet: () => {
      void deps.setOrigin().then(() => {
        deps.setJobPlacement({ startFrom: 'user-origin' });
        deps.pushToast('Origin set to current head position (G92).', 'success');
      });
    },
    onReset: () => {
      void deps
        .resetOrigin()
        .then(() =>
          deps.pushToast('Work origin cleared — back to machine zero (G92.1).', 'success'),
        );
    },
    onRelease: () => {
      if (!jobAwareConfirm(RELEASE_MOTORS_CONFIRM)) return;
      void deps
        .releaseMotors()
        .then(() =>
          deps.pushToast(
            'Motors released ($SLP). Move the head by hand, then Wake and Set origin again.',
            'success',
          ),
        );
    },
  };
}

function GoToWorkZeroButton(props: {
  readonly busy: boolean;
  readonly hasCustom: boolean;
}): JSX.Element {
  const jogToMachinePosition = useLaserStore((state) => state.jogToMachinePosition);
  const wcoCache = useLaserStore((state) => state.wcoCache);
  const idle = useLaserStore((state) => state.statusReport?.state === 'Idle');
  const maxFeed = useStore((state) => state.project.device.maxFeed);
  const requestedFeed = useJogControlPreferences((state) => state.requestedFeedMmPerMin);
  const pushToast = useToastStore((state) => state.pushToast);
  const ready = !props.busy && props.hasCustom && wcoCache !== null && idle;
  const onGo = (): void => {
    if (wcoCache === null) return;
    void jogToMachinePosition(wcoCache.x, wcoCache.y, clampJogFeed(requestedFeed, maxFeed)).catch(
      (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        pushToast(`Cannot move to work zero: ${reason}`, 'warning');
      },
    );
  };
  return (
    <button
      type="button"
      onClick={onGo}
      disabled={!ready}
      title={
        props.hasCustom && wcoCache !== null
          ? 'Move the head to work X0 Y0 with the beam off.'
          : 'Set a work origin and wait for its controller position before returning to it.'
      }
    >
      Go to work zero
    </button>
  );
}

function AdvancedOriginControls(props: {
  readonly busy: boolean;
  readonly hasCustom: boolean;
  readonly persistentOriginReady: boolean;
}): JSX.Element {
  const setPersistentOrigin = useLaserStore((s) => s.setPersistentOriginHere);
  const clearPersistentOrigin = useLaserStore((s) => s.clearPersistentOrigin);
  const setJobPlacement = useStore((s) => s.setJobPlacement);
  const pushToast = useToastStore((s) => s.pushToast);
  const onSetPersistent = (): void => {
    if (!jobAwareConfirm(SET_PERSISTENT_ORIGIN_CONFIRM)) return;
    void setPersistentOrigin().then(() => {
      setJobPlacement({ startFrom: 'user-origin' });
      pushToast('Persistent G54 origin set to current head position.', 'success');
    });
  };
  const onClearPersistent = (): void => {
    if (!jobAwareConfirm(CLEAR_PERSISTENT_ORIGIN_CONFIRM)) return;
    void clearPersistentOrigin().then(() => pushToast('Persistent G54 origin cleared.', 'success'));
  };
  const persistentDisabled = props.busy || !props.persistentOriginReady;
  const setTitle = props.persistentOriginReady
    ? 'Write the current head position as the persistent G54 origin (G10 L20 P1).'
    : 'Machine must be Idle before setting the persistent G54 origin.';
  const clearTitle = props.persistentOriginReady
    ? 'Clear transient G92 and stored G54 origin offsets.'
    : 'Machine must be Idle before clearing the persistent G54 origin.';
  return (
    <details style={advancedDetailsStyle}>
      <summary
        style={{ cursor: props.busy ? 'default' : 'pointer' }}
        title="Show persistent G54 origin controls."
      >
        Advanced origin
      </summary>
      <div style={advancedButtonRowStyle}>
        <button
          type="button"
          onClick={onSetPersistent}
          disabled={persistentDisabled}
          title={setTitle}
        >
          Set persistent origin
        </button>
        <button
          type="button"
          onClick={onClearPersistent}
          disabled={persistentDisabled || !props.hasCustom}
          title={clearTitle}
        >
          Clear persistent origin
        </button>
      </div>
    </details>
  );
}

const originRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  minWidth: 0,
};

const advancedDetailsStyle: React.CSSProperties = {
  display: 'block',
  flexBasis: '100%',
  maxWidth: '100%',
  minWidth: 0,
};

const advancedButtonRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 6,
  minWidth: 0,
};
