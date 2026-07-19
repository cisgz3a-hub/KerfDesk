import { useState } from 'react';
import type { DeviceProfile } from '../../core/devices';
import { useStore } from '../state';
import {
  projectAirAssistDefaultSyncSummary,
  type AirAssistDefaultSyncSummary,
} from '../state/air-assist-default-actions';
import { useLaserStore } from '../state/laser-store';

export function JogPadAirAssist(): JSX.Element {
  const [setupOpen, setSetupOpen] = useState(false);
  const project = useStore((s) => s.project);
  const syncProjectAirAssistDefaults = useStore((s) => s.syncProjectAirAssistDefaults);
  const airAssistOn = useLaserStore((s) => s.airAssistOn);
  const setAirAssistEnabled = useLaserStore((s) => s.setAirAssistEnabled);
  const setupSummary = projectAirAssistDefaultSyncSummary(project);
  const handleToggle = (enabled: boolean): void => {
    if (enabled && setupSummary.needsSync) {
      setSetupOpen(true);
      return;
    }
    if (!enabled) setSetupOpen(false);
    void setAirAssistEnabled(enabled).catch(() => undefined);
  };
  const proceedWithSetup = (): void => {
    syncProjectAirAssistDefaults();
    setSetupOpen(false);
    // Never guess M7 or M8. With no verified relay command, Proceed only
    // normalizes the per-job Air flags; the external/manual pump stays a
    // physical operator action disclosed in Job Review.
    if (!setupSummary.airOutputUnset) {
      void setAirAssistEnabled(true).catch(() => undefined);
    }
  };
  return (
    <>
      <AirAssistControl
        command={project.device.airAssistCommand}
        enabled={airAssistOn}
        setupNeeded={setupSummary.needsSync}
        onToggle={handleToggle}
      />
      {setupOpen && setupSummary.needsSync ? (
        <AirAssistSetupWarning
          summary={setupSummary}
          onProceed={proceedWithSetup}
          onCancel={() => setSetupOpen(false)}
        />
      ) : null}
    </>
  );
}

function AirAssistControl(props: {
  readonly command: DeviceProfile['airAssistCommand'];
  readonly enabled: boolean;
  readonly setupNeeded: boolean;
  readonly onToggle: (enabled: boolean) => void;
}): JSX.Element {
  const commandAvailable = props.command !== 'none';
  const label = props.enabled
    ? 'Turn manual air assist off (M9)'
    : `Turn manual air assist on (${props.setupNeeded ? 'setup needed' : props.command})`;
  const title = props.setupNeeded
    ? 'Review and apply missing air-assist settings before turning manual air on.'
    : `${label}. Jobs use each layer's Job Air checkbox automatically.`;
  return (
    <button
      type="button"
      onClick={() => props.onToggle(!props.enabled)}
      aria-label={label}
      aria-pressed={props.enabled}
      title={title}
      style={airAssistButtonStyle(props.enabled, props.setupNeeded)}
    >
      <span style={airAssistTitleStyle}>Manual Air</span>
      <span style={airAssistStateStyle}>{props.enabled ? 'ON' : 'OFF'}</span>
      <span style={airAssistCommandStyle}>
        {props.setupNeeded ? 'Setup needed' : commandAvailable ? props.command : 'Not set'}
      </span>
    </button>
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
  const updates = changes.length === 0 ? '' : ` This will ${changes.join(', ')}.`;
  const outputNotice = summary.airOutputUnset
    ? ' No M7/M8 output will be selected; configure one in Machine Setup only after a hardware test, or operate the external air pump manually.'
    : '';
  return `${updates}${outputNotice}`;
}

function airAssistButtonStyle(enabled: boolean, setupNeeded: boolean): React.CSSProperties {
  if (setupNeeded && !enabled) {
    return {
      ...airAssistButtonBaseStyle,
      borderColor: 'var(--lf-warning)',
      background: 'var(--lf-tint-warning)',
      color: 'var(--lf-warning-fg)',
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
  minHeight: 116,
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
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1.15,
};
const airAssistStateStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  lineHeight: 1,
};
const airAssistCommandStyle: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.2,
};
const airSetupWarningStyle: React.CSSProperties = {
  gridArea: 'warning',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
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
  gap: 6,
  flexShrink: 0,
};
const airSetupProceedButtonStyle: React.CSSProperties = {
  borderColor: 'var(--lf-warning)',
  background: 'var(--lf-warning)',
  color: 'var(--lf-on-fill)',
};
