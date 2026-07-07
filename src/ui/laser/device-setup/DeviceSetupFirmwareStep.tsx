// Step 5 of the Device Setup wizard: optionally write the draft's values back
// to the controller's firmware so it matches the profile (ADR-092). Diffs come
// from the pure computeFirmwareDiffs; each write goes through the existing
// guarded writeGrblSetting action (connected + Idle + value-validated, then
// re-read and verified). Only 'common'-risk settings ($30/$31/$32) are
// writable here; machine-critical mismatches (bed travel) are info-only.

import { useState } from 'react';
import { Button } from '../../kit';
import { useStore } from '../../state';
import { isActiveJob } from '../../state/laser-store-helpers';
import { useLaserStore } from '../../state/laser-store';
import { useToastStore } from '../../state/toast-store';
import type { DeviceSetupState } from './device-setup-flow';
import { computeFirmwareDiffs, type FirmwareDiff } from './device-setup-firmware-diff';

export function DeviceSetupFirmwareStep({
  state,
}: {
  readonly state: DeviceSetupState;
}): JSX.Element {
  const rows = useLaserStore((s) => s.grblSettingsRows);
  const lastReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const connection = useLaserStore((s) => s.connection);
  const machine = useStore((s) => s.project.machine);
  if (connection.kind !== 'connected') {
    return (
      <section style={sectionStyle}>
        <p style={hintStyle}>
          Connect the controller to sync settings. This step is optional — you can skip it and just
          save the profile.
        </p>
      </section>
    );
  }
  if (lastReadAt === null) {
    return (
      <section style={sectionStyle}>
        <p style={hintStyle}>
          No controller settings have been read yet. Go back to step 1 and Re-read ($$) to compare.
          This step is optional.
        </p>
      </section>
    );
  }
  const diffs = computeFirmwareDiffs(state.draft, rows, machine);
  const writable = diffs.filter((diff) => diff.differs && diff.writable);
  const infoOnly = diffs.filter((diff) => diff.differs && !diff.writable);
  return (
    <section style={sectionStyle}>
      <p style={hintStyle}>
        Optionally write the values below to your controller so its firmware matches this profile.
        Each write is confirmed and verified individually.
      </p>
      {writable.length === 0 && infoOnly.length === 0 ? (
        <p style={okStyle}>Your controller already matches this profile.</p>
      ) : null}
      {writable.map((diff) => (
        <FirmwareSyncRow key={diff.id} diff={diff} />
      ))}
      {infoOnly.length > 0 ? (
        <div style={infoStyle}>
          <strong>Not written here:</strong>
          <ul style={listStyle}>
            {infoOnly.map((diff) => (
              <li key={diff.id}>
                {diff.code} {diff.label}: controller {diff.current} → profile {diff.desired}. Use
                the batch GRBL setup in Machine Setup for travel limits.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function FirmwareSyncRow({ diff }: { readonly diff: FirmwareDiff }): JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  const connection = useLaserStore((s) => s.connection);
  const statusReport = useLaserStore((s) => s.statusReport);
  const streamer = useLaserStore((s) => s.streamer);
  const motionOperation = useLaserStore((s) => s.motionOperation);
  const controllerOperation = useLaserStore((s) => s.controllerOperation);
  const autofocusBusy = useLaserStore((s) => s.autofocusBusy);
  const writeGrblSetting = useLaserStore((s) => s.writeGrblSetting);
  const pushToast = useToastStore((s) => s.pushToast);
  const canWrite =
    confirmed &&
    connection.kind === 'connected' &&
    statusReport?.state === 'Idle' &&
    !isActiveJob(streamer) &&
    motionOperation === null &&
    controllerOperation === null &&
    !autofocusBusy;
  const write = (): void => {
    void writeGrblSetting(diff.id, diff.desired)
      .then(() => {
        // Re-arm the confirm gate so a second write requires re-confirmation.
        setConfirmed(false);
        pushToast(`${diff.code} write sent; re-reading controller settings.`, 'success');
      })
      .catch((error: unknown) =>
        pushToast(error instanceof Error ? error.message : String(error), 'error'),
      );
  };
  return (
    <article style={rowStyle}>
      <div style={rowInfoStyle}>
        <strong>{diff.code}</strong> {diff.label}
        <span style={mutedStyle}>
          {' '}
          — controller {diff.current} → profile {diff.desired}
        </span>
      </div>
      <label style={confirmStyle} title={`Confirm writing ${diff.code}=${diff.desired}.`}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          aria-label={`Confirm write ${diff.code}`}
          title={`Confirm writing ${diff.code} to the controller.`}
        />
        Confirm
      </label>
      <Button
        variant="primary"
        disabled={!canWrite}
        onClick={write}
        title={`Write ${diff.code}=${diff.desired} to the controller's firmware.`}
      >
        Write {diff.code}
      </Button>
    </article>
  );
}

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.4,
};
const okStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-success)', fontWeight: 600 };
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: 6,
};
const rowInfoStyle: React.CSSProperties = { flex: 1, fontSize: 12, minWidth: 180 };
const mutedStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const confirmStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  cursor: 'pointer',
};
const infoStyle: React.CSSProperties = { fontSize: 12, color: 'var(--lf-text-muted)' };
const listStyle: React.CSSProperties = { margin: '4px 0 0 0', paddingLeft: 18, lineHeight: 1.5 };
