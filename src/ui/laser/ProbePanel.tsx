// ProbePanel — the right-rail touch-plate probing panel (ADR-103 G2, F-CNC20).
// CNC-only chrome around ProbeControls; the same controls are also hosted in
// the CNC Material & Bit panel and the Device-Setup wizard (F-CNC20 setup).

import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import { ProbeControls } from './ProbeControls';
import { ProbePlateRemovalNotice } from './ProbePlateRemovalNotice';
import { WorkZRecoveryControl } from './WorkZRecoveryControl';

export function ProbePanel(): JSX.Element | null {
  const isCnc = useStore((s) => machineKindOf(s.project.machine) === 'cnc');
  if (!isCnc) return null;
  return (
    <>
      <details style={boxStyle}>
        <summary
          style={summaryStyle}
          title="Zero the work coordinates with a conductive touch plate (G38.2)."
        >
          Probe (touch plate)
        </summary>
        <ProbeControls />
      </details>
      {/* Outside the collapsed details: the confirmation gates CNC Start, so it
          must be visible even when the probe section is folded. */}
      <ProbePlateRemovalNotice />
      <WorkZRecoveryControl />
    </>
  );
}

const boxStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '6px 8px',
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontWeight: 600 };
