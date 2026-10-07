import { useState } from 'react';
import { firmwareReportQuery } from '../../../core/controllers/controller-firmware-report';
import { selectControllerDriver } from '../../../core/controllers';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { machineSettingsReadBlockReason } from '../../state/machine-settings-read-readiness';
import { SurfaceProbeDialog } from '../surface-probe/SurfaceProbeDialog';
import { machineProtocolInventory } from './machine-protocol-inventory';
import type { ControllerFirmwareReport } from '../../../core/controllers/controller-firmware-report';

export function MachineProtocolInventory(): JSX.Element {
  const device = useStore((state) => state.project.device);
  const laser = useLaserStore();
  const [message, setMessage] = useState('');
  const [surfaceOpen, setSurfaceOpen] = useState(false);
  const driver = selectControllerDriver(
    laser.activeControllerKind,
    laser.activeControllerCommandSet ?? undefined,
  );
  const query = firmwareReportQuery(driver);
  const blocked = machineSettingsReadBlockReason(laser);
  const report =
    laser.controllerFirmwareReport?.sessionEpoch === laser.controllerSessionEpoch &&
    laser.connection.kind === 'connected'
      ? laser.controllerFirmwareReport
      : null;
  return (
    <>
      <details>
        <summary title="Review declared protocol support and explicitly request a local firmware report.">
          Machine protocol and firmware
        </summary>
        <p>
          Profile declarations and firmware-reported claims are separate from physical machine
          qualification.
        </p>
        <table>
          <tbody>
            {machineProtocolInventory(device, laser).map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          title={
            blocked ??
            (query === null
              ? 'No documented query for this command set'
              : `Read ${query} once; no settings writes or motion`)
          }
          disabled={blocked !== null || query === null}
          onClick={() => {
            setMessage('Reading firmware report…');
            void laser.readFirmwareReport().then(
              () => setMessage('Current-session firmware report captured locally.'),
              (error: unknown) =>
                setMessage(error instanceof Error ? error.message : String(error)),
            );
          }}
        >
          Read firmware report
        </button>
        {laser.capabilities.probing && (
          <button
            type="button"
            title="Set up and review a measured GRBL-family surface grid. Requires powered Z and a working probe."
            onClick={() => setSurfaceOpen(true)}
          >
            Measure surface grid…
          </button>
        )}
        {message !== '' && <p role="status">{message}</p>}
        {report !== null && <FirmwareReportView report={report} />}
      </details>
      {surfaceOpen && <SurfaceProbeDialog onClose={() => setSurfaceOpen(false)} />}
    </>
  );
}

function FirmwareReportView({
  report,
}: {
  readonly report: ControllerFirmwareReport;
}): JSX.Element {
  return (
    <>
      <p>
        Reported by {report.query} at {new Date(report.observedAt).toLocaleTimeString()}. Reported
        options do not change supported app operations.
      </p>
      <table>
        <tbody>
          {report.fields.map((field) => (
            <tr key={field.name}>
              <th scope="row">{field.name}</th>
              <td>{field.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.reportedCapabilities.length > 0 && (
        <p>
          Firmware claims:{' '}
          {report.reportedCapabilities
            .map((cap) => `${cap.name}=${cap.enabled ? '1' : '0'}`)
            .join(', ')}
        </p>
      )}
    </>
  );
}
