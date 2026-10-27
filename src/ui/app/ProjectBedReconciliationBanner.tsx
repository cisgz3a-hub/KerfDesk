import { Button } from '../kit';
import { useStore } from '../state';
import type {
  CameraCalibrationChange,
  ProjectBedReconciliationNotice,
} from '../state/project-bed-reconciliation';

export function ProjectBedReconciliationBanner(): JSX.Element | null {
  const notice = useStore((state) => state.projectBedReconciliation);
  const accept = useStore((state) => state.acceptOpenedProjectMachine);
  const keepCurrent = useStore((state) => state.keepCurrentMachineForOpenedProject);
  if (notice === null) return null;
  const mismatch = notice.workspaceMismatch
    ? ` Its saved workspace was ${size(notice.openedWorkspace)}, while the project machine bed is ${size(notice.openedBed)}; the runtime canvas, nesting, preflight, and output now use the machine bed.`
    : '';
  // The same machine with another bed size is most often a file saved before
  // the bed was corrected: keeping the current machine is the safe choice
  // (ADR-440 Amendment 5). The bed words alone fit only when nothing else
  // differs; otherwise each other setting in use is named (Amendment 8).
  if (notice.sameProfile) {
    return (
      <section role="status" aria-label="Opened project machine disclosure" style={bannerStyle}>
        <span>
          <strong>Opened project machine:</strong> {bedSizeWords(notice)}
          {settingsWords(notice)}
          {cameraWords(notice.camera)}
          {mismatch} {keepWords(notice)}
        </span>
        <span style={actionsStyle}>
          <Button variant="primary" onClick={keepCurrent}>
            Keep current machine
          </Button>
          <Button onClick={accept}>Use project machine</Button>
        </span>
      </section>
    );
  }
  const machine = notice.machineChanged
    ? ` Opening it selected “${notice.openedDeviceName}” instead of the current “${notice.previousDeviceName}”.`
    : '';
  return (
    <section role="status" aria-label="Opened project machine disclosure" style={bannerStyle}>
      <span>
        <strong>Opened project machine:</strong>
        {machine}
        {otherMachineWords(notice)}
        {cameraWords(notice.camera)}
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

function bedSizeWords(notice: ProjectBedReconciliationNotice): string {
  return `This project was saved for “${notice.openedDeviceName}” with a ${size(notice.openedBed)} bed, and your “${notice.previousDeviceName}” is set up with a ${size(bedOf(notice.previousDevice))} bed.`;
}

// The file's copy of the same machine can hold an older origin or no-go zones
// too: they are in use behind the notice, so they are named, origin first.
function settingsWords(notice: ProjectBedReconciliationNotice): string {
  const settings = notice.differingSettings;
  if (settings.length === 0)
    return ` The project's ${size(notice.openedBed)} bed is in use for now.`;
  return ` The file's copy also differs in ${list(settings)}. Its ${list(['bed', ...settings])} are in use for now, not yours.`;
}

function otherMachineWords(notice: ProjectBedReconciliationNotice): string {
  if (!notice.machineChanged) return '';
  const opened = notice.openedBed;
  const bed = sameSize(opened, bedOf(notice.previousDevice)) ? [] : [`bed (${size(opened)})`];
  const brought = [...bed, ...notice.differingSettings];
  if (brought.length === 0) return '';
  const verb = brought.length === 1 ? 'is' : 'are';
  return ` That machine's ${list(brought)} ${verb} in use for now, not yours.`;
}

function keepWords(notice: ProjectBedReconciliationNotice): string {
  const current = size(bedOf(notice.previousDevice));
  const kept = [
    `${current} bed`,
    ...notice.differingSettings,
    ...(notice.camera === null ? [] : ['camera calibration']),
  ];
  const them = kept.length === 1 ? 'it' : 'them';
  return `Keep current machine keeps your ${list(kept)}. Use project machine replaces ${them} with the file's, and the next change to the machine saves that in place of yours.`;
}

function list(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function sameSize(
  a: { readonly width: number; readonly height: number },
  b: { readonly width: number; readonly height: number },
): boolean {
  return a.width === b.width && a.height === b.height;
}

// The camera follows the machine (ADR-440 Amendment 3 Decision 4), so a
// machine notice says when it swaps the calibration too.
function cameraWords(camera: CameraCalibrationChange | null): string {
  if (camera === null) return '';
  const opened = camera.openedCalibratedAt;
  const current = camera.currentCalibratedAt;
  if (opened === null) {
    return ` This file has no camera calibration, so the camera is not calibrated for now${current === null ? '' : `; your machine's is from ${date(current)}`}.`;
  }
  const instead = current === null ? '' : ` instead of your machine's from ${date(current)}`;
  return ` The camera now uses the file's calibration from ${date(opened)}${instead}.`;
}

function bedOf(device: ProjectBedReconciliationNotice['previousDevice']): {
  readonly width: number;
  readonly height: number;
} {
  return { width: device.bedWidth, height: device.bedHeight };
}

function date(iso: string): string {
  return new Date(iso).toLocaleDateString();
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
