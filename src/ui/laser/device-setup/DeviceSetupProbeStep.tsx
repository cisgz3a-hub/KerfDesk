// DeviceSetupProbeStep — the wizard's touch-plate work-zero step (F-CNC20).
// Optional and always skippable. Hosts the shared ProbeControls for CNC
// machines; in laser mode (the wizard is shared across kinds) it shows a skip
// note. Probing is a live controller action, not draft data, so this step makes
// no edits to the setup profile.

import { machineKindOf } from '../../../core/scene';
import { useStore } from '../../state';
import { ProbeControls } from '../ProbeControls';

export function DeviceSetupProbeStep(): JSX.Element {
  const isCnc = useStore((s) => machineKindOf(s.project.machine) === 'cnc');
  return (
    <div>
      {isCnc ? (
        <>
          <p style={hintStyle}>
            Optional: zero the work coordinates with a conductive touch plate now (needs a connected
            controller at Idle), or click Next to skip and probe later from the CNC panel.
          </p>
          <ProbeControls />
        </>
      ) : (
        <p style={hintStyle}>Touch-plate probing applies to CNC machines. Click Next to skip.</p>
      )}
    </div>
  );
}

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  margin: '0 0 8px 0',
};
