// CncDetectedSettingsRow — an opt-in banner that fills the CNC machine from the
// connected controller's detected `$$` settings (ADR-111). It renders only when
// the controller reported values that differ from the current setup. Apply copies
// configured travel; spindle RPM requires an explicitly selected S mapping. Nothing
// changes until the operator clicks Apply. Cross-store read of the laser store
// mirrors ProbePanel (both are top-level Zustand stores).

import type { CncMachineConfig } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { cncDetectedSpindleScale, computeCncDetectedApply } from './cnc-detected-apply';
import { SpindleScaleChoice } from './SpindleScaleChoice';
import { useSpindleScaleChoice } from './use-spindle-scale-choice';

export function CncDetectedSettingsRow(props: {
  readonly machine: CncMachineConfig;
}): JSX.Element | null {
  const detected = useLaserStore((s) => s.controllerSettings);
  const device = useStore((s) => s.project.device);
  const applyCncMachineSetup = useStore((s) => s.applyCncMachineSetup);
  const scale = cncDetectedSpindleScale(detected);
  const rpmChoice = useSpindleScaleChoice(scale);
  const offerRpm = scale !== undefined && scale !== props.machine.params.spindleMaxRpm;
  const apply =
    detected === null
      ? null
      : computeCncDetectedApply(detected, props.machine, device, offerRpm && rpmChoice.checked);
  if (apply === null && !offerRpm) return null;
  const handleApply = (): void => {
    if (apply !== null) applyCncMachineSetup(apply);
  };
  return (
    <div style={bannerStyle} role="status" aria-label="Detected machine settings">
      <span style={textStyle}>
        {apply === null ? 'No RPM mapping selected.' : `Apply ${apply.summary}.`}
        {offerRpm && scale !== undefined ? (
          <SpindleScaleChoice
            value={scale}
            checked={rpmChoice.checked}
            onChange={rpmChoice.onChange}
          />
        ) : null}
      </span>
      <button
        type="button"
        onClick={handleApply}
        disabled={apply === null}
        title="Copy configured travel and any explicitly selected spindle RPM mapping."
        style={buttonStyle}
      >
        Apply
      </button>
    </div>
  );
}

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  marginBottom: 6,
  border: '1px solid var(--lf-accent)',
  borderRadius: 4,
  background: 'var(--lf-bg-1)',
};
const textStyle: React.CSSProperties = { flex: 1, fontSize: 12, color: 'var(--lf-text)' };
const buttonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '2px 10px',
  cursor: 'pointer',
  color: 'var(--lf-accent-fg)',
  border: '1px solid var(--lf-accent)',
  borderRadius: 4,
  background: 'transparent',
};
