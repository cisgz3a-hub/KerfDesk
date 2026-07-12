import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { profileSupportsCapability, type LaserFireControl } from '../../core/devices';
import { machineKindOf, type Project } from '../../core/scene';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { useStore } from '../state/store';

export function MomentaryFireControl(): JSX.Element | null {
  const project = useStore((state) => state.project);
  const labsEnabled = useExperimentalLaserFeatures((state) => state.features.lowPowerFire);
  const laser = useLaserStore();
  const control = availableFireControl(project, labsEnabled, laser);
  const { held, release } = useMomentaryRelease(laser.setFireActive);

  useEffect(() => {
    if (control === null) release();
  }, [control, release]);
  if (control === null) return null;

  const disabled = fireControlDisabled(laser);
  const press = (): void => {
    if (disabled || held.current) return;
    held.current = true;
    void laser.setFireActive(true, control.maxPowerPercent).catch(() => {
      held.current = false;
    });
  };

  return (
    <button
      type="button"
      aria-label={`Hold for low-power Fire at ${control.maxPowerPercent}%`}
      aria-pressed={laser.fireActive}
      disabled={disabled}
      onPointerDown={(event) => {
        event.preventDefault();
        press();
      }}
      onPointerLeave={release}
      onKeyDown={(event) => {
        if (isFireKey(event.key) && !event.repeat) {
          event.preventDefault();
          press();
        }
      }}
      onKeyUp={(event) => {
        if (isFireKey(event.key)) release();
      }}
      style={fireButtonStyle(laser.fireActive)}
      title={`Hold to turn on the positioning beam at no more than ${control.maxPowerPercent}%. Release always sends M5.`}
    >
      <span style={titleStyle}>Fire</span>
      <span style={stateStyle}>{laser.fireActive ? 'ON' : `HOLD ${control.maxPowerPercent}%`}</span>
    </button>
  );
}

function useMomentaryRelease(setFireActive: LaserState['setFireActive']): {
  readonly held: MutableRefObject<boolean>;
  readonly release: () => void;
} {
  const held = useRef(false);
  const release = useCallback(() => {
    if (!held.current && !useLaserStore.getState().fireActive) return;
    held.current = false;
    void setFireActive(false).catch(() => undefined);
  }, [setFireActive]);

  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') release();
    };
    window.addEventListener('blur', release);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', release);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      release();
    };
  }, [release]);
  return { held, release };
}

function availableFireControl(
  project: Project,
  labsEnabled: boolean,
  laser: LaserState,
): LaserFireControl | null {
  if (!labsEnabled || machineKindOf(project.machine) !== 'laser') return null;
  if (!laser.capabilities.lowPowerFire) return null;
  if (!profileSupportsCapability(project.device, 'low-power-fire')) return null;
  return project.device.fireControl?.enabled === true ? project.device.fireControl : null;
}

function fireControlDisabled(laser: LaserState): boolean {
  const positionUnknown =
    laser.statusReport === null ||
    (laser.statusReport.mPos === null && laser.statusReport.wPos === null);
  return [
    laser.connection.kind !== 'connected',
    laser.statusReport?.state !== 'Idle',
    positionUnknown,
    laser.alarmCode !== null,
    isActiveJob(laser.streamer),
    laser.motionOperation !== null,
    laser.controllerOperation !== null,
    laser.autofocusBusy,
    laser.probeBusy,
    laser.pendingUntrackedAcks > 0,
  ].some(Boolean);
}

function isFireKey(key: string): boolean {
  return key === ' ' || key === 'Enter';
}

function fireButtonStyle(active: boolean): React.CSSProperties {
  return {
    minWidth: 76,
    height: 58,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    border: active ? '1px solid var(--lf-danger)' : '1px solid var(--lf-border)',
    background: active ? 'var(--lf-danger)' : 'var(--lf-bg-2)',
    color: active ? 'var(--lf-on-fill)' : 'var(--lf-text)',
    borderRadius: 4,
    userSelect: 'none',
    touchAction: 'none',
  };
}

const titleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700 };
const stateStyle: React.CSSProperties = { fontSize: 10 };
