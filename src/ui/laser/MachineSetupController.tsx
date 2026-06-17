import { useState } from 'react';
import type { GrblSettingRow } from '../../core/controllers/grbl';
import { Button } from '../kit';
import { useLaserStore } from '../state/laser-store';
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
  return (
    <div style={stackStyle}>
      <GrblSetupSlot />
      <MachineSettingsPanel />
      <DetectedSettingsBanner />
    </div>
  );
}

function GrblSetupSlot(): JSX.Element {
  const connection = useLaserStore((s) => s.connection);
  const autofocusBusy = useLaserStore((s) => s.autofocusBusy);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const streamer = useLaserStore((s) => s.streamer);
  const disabled =
    connection.kind !== 'connected' ||
    autofocusBusy ||
    motionOperation !== null ||
    streamer !== null;
  return <GrblLaserSetupPanel disabled={disabled} />;
}

export function FirmwareWritesPanel(): JSX.Element {
  const rows = useLaserStore((s) => s.grblSettingsRows);
  const lastSettingsReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const writableRows = rows.filter(
    (row) => row.writeRisk === 'common' && COMMON_WRITE_IDS.has(row.id),
  );
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
  const writeGrblSetting = useLaserStore((s) => s.writeGrblSetting);
  const pushToast = useToastStore((s) => s.pushToast);
  const canWrite = confirmed && value.trim().length > 0;

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
