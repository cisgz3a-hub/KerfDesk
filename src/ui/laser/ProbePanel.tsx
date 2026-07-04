// ProbePanel — the right-rail touch-plate probing panel (ADR-103 G2, F-CNC20).
// CNC-only chrome around ProbeControls; the same controls are also hosted in
// the CNC Material & Bit panel and the Device-Setup wizard (F-CNC20 setup).

import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import { ProbeControls } from './ProbeControls';

export function ProbePanel(): JSX.Element | null {
  const isCnc = useStore((s) => machineKindOf(s.project.machine) === 'cnc');
  if (!isCnc) return null;
  return (
    <details style={boxStyle}>
      <summary
        style={summaryStyle}
        title="Zero the work coordinates with a conductive touch plate (G38.2)."
      >
        Probe (touch plate)
      </summary>
      <ProbeControls />
    </details>
  );
}

const boxStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '6px 8px',
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontWeight: 600 };
