import { useState } from 'react';
import type { GrblSettingRow } from '../../core/controllers/grbl';
import { Button } from '../kit';
import { CncDetectedSettingsRow } from '../machine/CncDetectedSettingsRow';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';
import { DetectedSettingsBanner } from './DetectedSettingsBanner';
import { GrblLaserSetupPanel } from './GrblLaserSetupPanel';
import { MachineSettingsPanel } from './MachineSettingsPanel';
import {
  cardStyle,
  firmwareGridStyle,
  inlineLabelStyle,
  mutedStyle,
  sectionHeadingStyle,
  sectionStyle,
  stackStyle,
} from './MachineSetupStyles';

const COMMON_WRITE_IDS = new Set([30, 31, 32]);

export function ControllerSettingsPanel(): JSX.Element {
  const machine = useStore((s) => s.project.machine);
  return (
    <div style={stackStyle}>
      <GrblSetupSlot />
      <MachineSettingsPanel />
      {machine?.kind === 'cnc' ? (
        <CncDetectedSettingsRow machine={machine} />
      ) : (
        <DetectedSettingsBanner />
      )}
    </div>
  );
}

function GrblSetupSlot(): JSX.Element | null {
  const machineKind = useStore((s) => s.project.machine?.kind ?? 'laser');
  const connection = useLaserStore((s) => s.connection);
  const autofocusBusy = useLaserStore((s) => s.autofocusBusy);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const streamer = useLaserStore((s) => s.streamer);
  const firmwareSetupPanel = useLaserStore((s) => s.capabilities.firmwareSetupPanel);
  // ADR-094: the $32/$30 setup sequence only exists on GRBL-dollar firmwares.
  if (machineKind === 'cnc' || firmwareSetupPanel !== 'grbl-laser') return null;
  const disabled =
    connection.kind !== 'connected' ||
    autofocusBusy ||
    motionOperation !== null ||
    controllerOperation !== null ||
    streamer !== null;
  return <GrblLaserSetupPanel disabled={disabled} />;
}

export function FirmwareWritesPanel(): JSX.Element {
  const rows = useLaserStore((s) => s.grblSettingsRows);
  const lastSettingsReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const settingsCapability = useLaserStore((s) => s.capabilities.settings);
  const writableRows = rows.filter(
    (row) => row.writeRisk === 'common' && COMMON_WRITE_IDS.has(row.id),
  );
  if (settingsCapability !== 'grbl-dollar') {
    return (
      <div style={stackStyle}>
        <section style={sectionStyle}>
          <h3 style={sectionHeadingStyle}>Guarded Writes</h3>
          <p style={mutedStyle}>
            This controller does not accept numeric $ setting writes from the app. Configure the
            firmware with its own tools.
          </p>
        </section>
      </div>
    );
  }
  return (
    <div style={stackStyle}>
      <section style={sectionStyle}>
        <h3 style={sectionHeadingStyle}>Guarded Writes</h3>
        <p style={mutedStyle}>
          Firmware writes are limited to one setting at a time. Read and export a current controller
          backup before writing.
        </p>
      </section>
      {lastSettingsReadAt === null ? (
        <p style={mutedStyle}>Read controller settings before firmware writes are available.</p>
      ) : null}
      {writableRows.map((row) => (
        <FirmwareWriteRow key={row.code} row={row} />
      ))}
      {lastSettingsReadAt !== null && writableRows.length === 0 ? (
        <p style={mutedStyle}>No common writable GRBL settings were found in the latest read.</p>
      ) : null}
    </div>
  );
}

function FirmwareWriteRow({ row }: { readonly row: GrblSettingRow }): JSX.Element {
  const [value, setValue] = useState(row.rawValue);
  const [confirmed, setConfirmed] = useState(false);
  const connection = useLaserStore((s) => s.connection);
  const streamer = useLaserStore((s) => s.streamer);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const autofocusBusy = useLaserStore((s) => s.autofocusBusy);
  const writeGrblSetting = useLaserStore((s) => s.writeGrblSetting);
  const pushToast = useToastStore((s) => s.pushToast);
  const canWrite =
    confirmed &&
    value.trim().length > 0 &&
    connection.kind === 'connected' &&
    !isActiveJob(streamer) &&
    motionOperation === null &&
    controllerOperation === null &&
    !autofocusBusy;

  const write = (): void => {
    void writeGrblSetting(row.id, value)
      .then(() => pushToast(`${row.code} write sent; re-reading controller settings.`, 'success'))
      .catch((error: unknown) => pushToast(errorMessage(error), 'error'));
  };

  return (
    <article style={cardStyle}>
      <div style={firmwareGridStyle}>
        <div>
          <strong>{row.code}</strong>
          <p style={mutedStyle}>{row.name}</p>
        </div>
        <label>
          <span>Current</span>
          <input
            value={row.rawValue}
            readOnly
            aria-label={`Current value for ${row.code}`}
            title={`Current readback value for ${row.code}.`}
          />
        </label>
        <label>
          <span>New</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-label={`New value for ${row.code}`}
            title={`Enter the new value for ${row.code}.`}
          />
        </label>
        <label style={inlineLabelStyle}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            aria-label={`Confirm write ${row.code}`}
            title={`Confirm you want to write ${row.code}.`}
          />
          Confirm
        </label>
        <Button variant="primary" disabled={!canWrite} onClick={write}>
          Write {row.code}
        </Button>
      </div>
    </article>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
