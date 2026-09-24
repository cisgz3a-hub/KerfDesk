import { useState } from 'react';
import type { DeviceProfile } from '../../core/devices';
// Deep import: the devices barrel is at its public-export ratchet.
import {
  presetAirAssistUpdate,
  type PresetAirAssistUpdate,
} from '../../core/devices/preset-air-assist';
import { useStore } from '../state';
import {
  projectAirAssistDefaultSyncSummary,
  type AirAssistDefaultSyncSummary,
} from '../state/air-assist-default-actions';
import { manualAirBlockMessage, useLaserStore } from '../state/laser-store';
import { openMachineSetup } from './device-setup';
import { controllerActionFailureHandler } from './report-controller-action-failure';

// Manual Air has two distinct "not ready" states and they need different
// exits (maintainer, 2026-09-19 — the old single Proceed card silently did
// nothing when the device had no air output, then came straight back):
//   - no M7/M8 output on the device: nothing here can turn a pump on, so the
//     only honest action is to open Machine Setup at the air-assist row;
//   - output configured but project Job Air defaults are off: Proceed applies
//     the listed defaults and then turns manual air on, in one click.
type AirAssistReadiness = 'ready' | 'no-output' | 'defaults';

export function JogPadAirAssist(): JSX.Element {
  const [noticeOpen, setNoticeOpen] = useState(false);
  const project = useStore((s) => s.project);
  const syncProjectAirAssistDefaults = useStore((s) => s.syncProjectAirAssistDefaults);
  const airAssistOn = useLaserStore((s) => s.airAssistOn);
  const setAirAssistEnabled = useLaserStore((s) => s.setAirAssistEnabled);
  const setupSummary = projectAirAssistDefaultSyncSummary(project);
  const readiness = airAssistReadiness(setupSummary);
  const handleToggle = (enabled: boolean): void => {
    if (enabled && readiness !== 'ready') {
      setNoticeOpen(true);
      return;
    }
    if (!enabled) setNoticeOpen(false);
    void setAirAssistEnabled(enabled).catch(controllerActionFailureHandler('Air assist'));
  };
  const proceedWithDefaults = (): void => {
    syncProjectAirAssistDefaults();
    setNoticeOpen(false);
    void setAirAssistEnabled(true).catch(controllerActionFailureHandler('Air assist'));
  };
  const openAirOutputSetup = (): void => {
    setNoticeOpen(false);
    openMachineSetup({ kind: 'step', step: 'confirm', highlight: 'air-assist' });
  };
  return (
    <>
      <AirAssistControl
        command={project.device.airAssistCommand}
        enabled={airAssistOn}
        readiness={readiness}
        onToggle={handleToggle}
      />
      {noticeOpen && readiness === 'no-output' ? (
        <AirOutputUnsetNotice
          preset={presetAirAssistUpdate(project.device)}
          onOpenSetup={openAirOutputSetup}
          onCancel={() => setNoticeOpen(false)}
        />
      ) : null}
      {noticeOpen && readiness === 'defaults' ? (
        <AirAssistSetupWarning
          summary={setupSummary}
          onProceed={proceedWithDefaults}
          onCancel={() => setNoticeOpen(false)}
        />
      ) : null}
    </>
  );
}

function airAssistReadiness(summary: AirAssistDefaultSyncSummary): AirAssistReadiness {
  if (summary.airOutputUnset) return 'no-output';
  if (summary.disabledOutputLayerCount > 0 || summary.disabledObjectOverrideCount > 0) {
    return 'defaults';
  }
  return 'ready';
}

function AirAssistControl(props: {
  readonly command: DeviceProfile['airAssistCommand'];
  readonly enabled: boolean;
  readonly readiness: AirAssistReadiness;
  readonly onToggle: (enabled: boolean) => void;
}): JSX.Element {
  // The store's own refusal for this click, if any. A 'no-output' or
  // 'defaults' button stays clickable: its click opens the setup notice.
  const blocked = useLaserStore((s) => manualAirBlockMessage(s, !s.airAssistOn));
  const disabled = blocked !== null && props.readiness === 'ready';
  const label = props.enabled
    ? 'Turn manual air assist off (M9)'
    : `Turn manual air assist on (${controlSuffix(props.readiness, props.command)})`;
  const title = disabled ? blocked : controlTitle(props.readiness, label);
  return (
    <button
      type="button"
      onClick={() => props.onToggle(!props.enabled)}
      disabled={disabled}
      aria-label={label}
      aria-pressed={props.enabled}
      className="lf-manual-air"
      title={title}
      style={airAssistButtonStyle(props.enabled, props.readiness)}
    >
      <span style={airAssistTitleStyle}>Manual Air</span>
      <span style={airAssistStateStyle}>{props.enabled ? 'ON' : 'OFF'}</span>
      <span style={airAssistCommandStyle}>{controlCaption(props.readiness, props.command)}</span>
    </button>
  );
}

function controlSuffix(
  readiness: AirAssistReadiness,
  command: DeviceProfile['airAssistCommand'],
): string {
  if (readiness === 'no-output') return 'no air output';
  if (readiness === 'defaults') return 'setup needed';
  return command;
}

function controlCaption(
  readiness: AirAssistReadiness,
  command: DeviceProfile['airAssistCommand'],
): string {
  if (readiness === 'no-output') return 'No air output';
  if (readiness === 'defaults') return 'Setup needed';
  return command;
}

function controlTitle(readiness: AirAssistReadiness, label: string): string {
  if (readiness === 'no-output') {
    return 'No M7/M8 air output is configured for this machine, so there is nothing to switch. Open Machine Setup to set one after a hardware test.';
  }
  if (readiness === 'defaults') {
    return 'Review and apply missing air-assist settings before turning manual air on.';
  }
  return `${label}. Jobs use each layer's Job Air checkbox automatically.`;
}

function AirOutputUnsetNotice(props: {
  readonly preset: PresetAirAssistUpdate | null;
  readonly onOpenSetup: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  return (
    <div style={airSetupWarningStyle} role="status">
      <div style={airSetupWarningTextStyle}>
        <strong>Manual Air has no M7/M8 output to switch.</strong>
        <span>
          {props.preset === null
            ? 'Set the air output in Machine Setup only after a hardware test, or run the external air pump by hand.'
            : `The ${props.preset.presetName} preset uses ${props.preset.patch.airAssistCommand}; Machine Setup offers to apply it.`}
        </span>
      </div>
      <div style={airSetupWarningActionStyle}>
        <button
          type="button"
          onClick={props.onCancel}
          aria-label="Cancel air assist setup"
          title="Keep manual air off."
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={props.onOpenSetup}
          aria-label="Open Machine Setup for air assist"
          title="Open Machine Setup at the machine step that holds the air-assist output."
          style={airSetupProceedButtonStyle}
        >
          Open Machine Setup
        </button>
      </div>
    </div>
  );
}

function AirAssistSetupWarning(props: {
  readonly summary: AirAssistDefaultSyncSummary;
  readonly onProceed: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  return (
    <div style={airSetupWarningStyle} role="status">
      <div style={airSetupWarningTextStyle}>
        <strong>Manual Air will update project air-assist settings.</strong>
        <span>{airSetupSummaryText(props.summary)}</span>
      </div>
      <div style={airSetupWarningActionStyle}>
        <button
          type="button"
          onClick={props.onCancel}
          aria-label="Cancel air assist setup"
          title="Leave project air-assist defaults unchanged and keep manual air off."
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={props.onProceed}
          aria-label="Proceed with air assist setup"
          title="Apply the listed air-assist defaults, then turn manual air on."
          style={airSetupProceedButtonStyle}
        >
          Proceed
        </button>
      </div>
    </div>
  );
}

function airSetupSummaryText(summary: AirAssistDefaultSyncSummary): string {
  const changes: string[] = [];
  if (summary.disabledOutputLayerCount > 0) {
    changes.push(`enable Job Air on ${summary.disabledOutputLayerCount} output layer(s)`);
  }
  if (summary.disabledObjectOverrideCount > 0) {
    changes.push(`clear ${summary.disabledObjectOverrideCount} stale object air override(s)`);
  }
  // Those are job settings: a completed Frame no longer matches afterwards, so
  // the next Start frames the job again (controller audit gap-start-9).
  return changes.length === 0
    ? ''
    : `This will ${changes.join(', ')}, then turn manual air on. The job changes, so Start frames it again first.`;
}

function airAssistButtonStyle(
  enabled: boolean,
  readiness: AirAssistReadiness,
): React.CSSProperties {
  if (readiness !== 'ready' && !enabled) {
    return {
      ...airAssistButtonBaseStyle,
      borderColor: 'var(--lf-border)',
      background: 'var(--lf-bg-0)',
      color: 'var(--lf-text-muted)',
      cursor: 'pointer',
    };
  }
  return {
    ...airAssistButtonBaseStyle,
    borderColor: enabled ? 'var(--lf-accent)' : 'var(--lf-border-strong)',
    background: enabled ? 'var(--lf-accent)' : 'var(--lf-bg-input)',
    color: enabled ? 'var(--lf-on-fill)' : 'var(--lf-text)',
    cursor: 'pointer',
  };
}

const airAssistButtonBaseStyle: React.CSSProperties = {
  gridArea: 'air',
  minHeight: 60,
  padding: '8px 6px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  borderWidth: 1,
  borderStyle: 'solid',
  borderRadius: 6,
  textAlign: 'center',
};
const airAssistTitleStyle: React.CSSProperties = {
  fontSize: 'var(--lf-text-sm)',
  fontWeight: 600,
  lineHeight: 1.15,
};
const airAssistStateStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1,
};
const airAssistCommandStyle: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.2,
};
// Spans the jog grid's full width (the "warning" row) and stacks its text
// over its actions: the rail is narrow, and a side-by-side layout squeezed
// the sentence into a five-word column beside the buttons.
const airSetupWarningStyle: React.CSSProperties = {
  gridArea: 'warning',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 8,
  padding: '8px 10px',
  borderLeft: '3px solid var(--lf-warning)',
  borderRadius: 4,
  background: 'var(--lf-tint-warning)',
  color: 'var(--lf-warning-fg)',
};
const airSetupWarningTextStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
  fontSize: 12,
  lineHeight: 1.3,
};
const airSetupWarningActionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 6,
  flexShrink: 0,
};
const airSetupProceedButtonStyle: React.CSSProperties = {
  borderColor: 'var(--lf-warning)',
  background: 'var(--lf-warning)',
  color: 'var(--lf-on-fill)',
};
