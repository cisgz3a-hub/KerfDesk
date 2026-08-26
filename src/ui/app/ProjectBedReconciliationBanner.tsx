import { Button } from '../kit';
import { useStore } from '../state';

export function ProjectBedReconciliationBanner(): JSX.Element | null {
  const notice = useStore((state) => state.projectBedReconciliation);
  const accept = useStore((state) => state.acceptOpenedProjectMachine);
  const keepCurrent = useStore((state) => state.keepCurrentMachineForOpenedProject);
  if (notice === null) return null;
  const mismatch = notice.workspaceMismatch
    ? ` Its saved workspace was ${size(notice.openedWorkspace)}, while the project machine bed is ${size(notice.openedBed)}; the runtime canvas, nesting, preflight, and output now use the machine bed.`
    : '';
  const machine = notice.machineChanged
    ? ` Opening it selected “${notice.openedDeviceName}” instead of the current “${notice.previousDeviceName}”.`
    : '';
  return (
    <section role="status" aria-label="Opened project machine disclosure" style={bannerStyle}>
      <span>
        <strong>Opened project machine:</strong>
        {machine}
        {mismatch} Choose which machine profile this project should retain.
      </span>
      <span style={actionsStyle}>
        <Button variant="primary" onClick={accept}>
          Use project machine
        </Button>
        <Button onClick={keepCurrent}>Keep current machine</Button>
      </span>
    </section>
  );
}

function size(value: { readonly width: number; readonly height: number }): string {
  return `${value.width} × ${value.height} mm`;
}

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 12px',
  borderBottom: '1px solid var(--lf-warning-border)',
  background: 'var(--lf-warning-bg)',
  color: 'var(--lf-text)',
  fontSize: 12,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexShrink: 0,
};
