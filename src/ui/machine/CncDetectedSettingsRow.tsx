// CncDetectedSettingsRow — an opt-in banner that fills the CNC machine from the
// connected controller's detected `$$` settings (ADR-106). It renders only when
// the controller reported values that differ from the current setup; Apply
// writes spindle max to the CNC params and bed size to the shared device, then
// the row disappears because nothing differs any more. Never silent — nothing
// changes until the operator clicks Apply. Cross-store read of the laser store
// mirrors ProbePanel (both are top-level Zustand stores).

import type { CncMachineConfig } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { computeCncDetectedApply } from './cnc-detected-apply';

export function CncDetectedSettingsRow(props: {
  readonly machine: CncMachineConfig;
}): JSX.Element | null {
  const detected = useLaserStore((s) => s.controllerSettings);
  const device = useStore((s) => s.project.device);
  const updateCncMachine = useStore((s) => s.updateCncMachine);
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  const apply = detected === null ? null : computeCncDetectedApply(detected, props.machine, device);
  if (apply === null) return null;
  const handleApply = (): void => {
    if (apply.paramsPatch.spindleMaxRpm !== undefined)
      updateCncMachine({ params: apply.paramsPatch });
    if (Object.keys(apply.devicePatch).length > 0) updateDeviceProfile(apply.devicePatch);
  };
  return (
    <div style={bannerStyle} role="status" aria-label="Detected machine settings">
      <span style={textStyle}>Machine reports {apply.summary}.</span>
      <button
        type="button"
        onClick={handleApply}
        title="Fill spindle max and bed size from the connected controller's reported settings."
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
  color: 'var(--lf-accent)',
  border: '1px solid var(--lf-accent)',
  borderRadius: 4,
  background: 'transparent',
};
