// The live probe input and its test touch (ADR-103 Amendments 2 and 4),
// shared by touch-off (ProbeControls) and the surface grid
// (SurfaceProbeDialog), which both seek Maximum travel until contact.

import { useLaserStore } from '../state/laser-store';
import { probeCircuitCheck, type ProbeCircuitCheck } from '../state/probe-test-touch';

/** Shows "Probe circuit: …" while connected and no probe cycle runs. `testedNext`
 * is the step the tested line points to, such as "Place the plate, then Run probe." */
export function ProbeCircuitLine(props: { readonly testedNext: string }): JSX.Element | null {
  const circuit = useLaserStore(probeCircuitCheck);
  const shown = useLaserStore((s) => s.connection.kind === 'connected' && !s.probeBusy);
  if (!shown) return null;
  return (
    <p role="status" aria-label="Probe circuit" style={circuitStyle(circuit)}>
      {probeCircuitLine(circuit, props.testedNext)}
    </p>
  );
}

function probeCircuitLine(circuit: ProbeCircuitCheck, testedNext: string): string {
  switch (circuit) {
    case 'untested':
      return 'Probe circuit: not tested. Hold the plate against the bit until this reads closed, then take it away.';
    case 'closed':
      return 'Probe circuit: closed. Take the plate away from the bit.';
    case 'tested':
      return `Probe circuit: tested. ${testedNext}`;
  }
}

function circuitStyle(circuit: ProbeCircuitCheck): React.CSSProperties {
  return {
    fontSize: 12,
    margin: '6px 0',
    color: circuit === 'tested' ? 'var(--lf-success-fg)' : 'var(--lf-text)',
    fontWeight: circuit === 'tested' ? 400 : 600,
  };
}
