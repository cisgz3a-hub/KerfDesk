import { useMemo, useState } from 'react';
import type { GrblSettingRow } from '../../../core/controllers/grbl';
import { compareSettingsSnapshots } from '../../../core/controllers/grbl/compare-settings-snapshots';
import type { ControllerKind, DeviceProfile } from '../../../core/devices';
import {
  controllerSettingsSnapshotToRows,
  createControllerSettingsSnapshot,
  deserializeControllerSettingsSnapshot,
  serializeControllerSettingsSnapshot,
  type ControllerSettingsSnapshot,
} from '../../../io/controller-settings-snapshot';
import type { PlatformAdapter } from '../../../platform/types';
import { usePlatform } from '../../app/platform-context';
import { useLaserStore } from '../../state/laser-store';
import {
  snapshotButtonRowStyle as buttonRowStyle,
  snapshotCaptureRowStyle as captureRowStyle,
  snapshotCellStyle as cellStyle,
  snapshotCompareHeadingStyle as compareHeadingStyle,
  snapshotLabelInputStyle as labelInputStyle,
  snapshotLabelStyle as labelStyle,
  snapshotMutedStyle as mutedStyle,
  snapshotNoticeStyle as noticeStyle,
  snapshotPanelStyle as panelStyle,
  snapshotSafetyNoteStyle as safetyNoteStyle,
  snapshotSlotDetailStyle as slotDetailStyle,
  snapshotSlotGridStyle as slotGridStyle,
  snapshotSlotStyle as slotStyle,
  snapshotStatusStyle as statusStyle,
  snapshotSummaryStyle as summaryStyle,
  snapshotTableStyle as tableStyle,
  snapshotTableWrapStyle as tableWrapStyle,
  snapshotValueCellStyle as valueCellStyle,
} from './super-console-snapshot-styles';

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
type SnapshotSlotId = 'A' | 'B';
type SnapshotComparison = ReturnType<typeof compareSettingsSnapshots>[number];

export function SuperConsoleSnapshotCompare(props: {
  readonly profile: DeviceProfile;
}): JSX.Element {
  const model = useSnapshotCompareModel(props.profile);
  return (
    <details style={panelStyle}>
      <summary
        style={summaryStyle}
        title="Expand or collapse read-only controller snapshot comparison."
      >
        Compare two controller snapshots
      </summary>
      <p style={noticeStyle}>
        Export each machine after a fresh <code>$$</code> read, then load both files here. Values
        are compared neutrally; higher speed or acceleration is not treated as better quality.
      </p>
      <SnapshotCaptureControls model={model} />
      <SnapshotSlots model={model} />
      {model.status === null ? null : (
        <p role="status" style={statusStyle}>
          {model.status}
        </p>
      )}
      <SnapshotComparisonResults model={model} />
    </details>
  );
}

function useSnapshotCompareModel(profile: DeviceProfile) {
  const platform = usePlatform();
  const rows = useLaserStore((state) => state.grblSettingsRows);
  const active = useLaserStore((state) => state.activeControllerKind);
  const detected = useLaserStore((state) => state.detectedControllerKind);
  const [operatorLabel, setOperatorLabel] = useState(profile.name);
  const [left, setLeft] = useState<ControllerSettingsSnapshot | null>(null);
  const [right, setRight] = useState<ControllerSettingsSnapshot | null>(null);
  const [showEquivalent, setShowEquivalent] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const comparison = useMemo(
    () => (left === null || right === null ? [] : compareSettingsSnapshots(left, right)),
    [left, right],
  );
  const names = useMemo(() => settingNames(left, right), [left, right]);
  const visibleComparison = showEquivalent
    ? comparison
    : comparison.filter((row) => row.status !== 'equivalent');
  const exportCurrent = (): void => {
    const label = operatorLabel.trim();
    if (rows.length === 0) return setStatus('Read controller settings before exporting.');
    if (label === '') return setStatus('Enter a machine label before exporting the snapshot.');
    void saveCurrentSnapshot({ platform, profile, rows, active, detected, label })
      .then((message) => {
        if (message !== null) setStatus(message);
      })
      .catch((error: unknown) => setStatus(`Snapshot export failed: ${errorMessage(error)}`));
  };
  const loadSlot = (slot: SnapshotSlotId): void => {
    void loadSnapshot(platform)
      .then((snapshot) => {
        if (snapshot === null) return;
        if (slot === 'A') setLeft(snapshot);
        else setRight(snapshot);
        setStatus(`Loaded snapshot ${slot}: ${snapshot.operatorLabel}.`);
      })
      .catch((error: unknown) => setStatus(`Snapshot ${slot} load failed: ${errorMessage(error)}`));
  };
  return {
    rowsCount: rows.length,
    operatorLabel,
    setOperatorLabel,
    left,
    right,
    status,
    comparison,
    visibleComparison,
    names,
    showEquivalent,
    setShowEquivalent,
    exportCurrent,
    loadSlot,
    clearSlot: (slot: SnapshotSlotId) => (slot === 'A' ? setLeft(null) : setRight(null)),
  };
}

type SnapshotCompareModel = ReturnType<typeof useSnapshotCompareModel>;

function SnapshotCaptureControls(props: { readonly model: SnapshotCompareModel }): JSX.Element {
  return (
    <div style={captureRowStyle}>
      <label style={labelStyle}>
        Current machine label
        <input
          aria-label="Current controller snapshot label"
          title="Name the connected machine in the exported settings snapshot."
          value={props.model.operatorLabel}
          onChange={(event) => props.model.setOperatorLabel(event.target.value)}
          style={labelInputStyle}
        />
      </label>
      <button
        type="button"
        title={
          props.model.rowsCount === 0
            ? 'Read controller settings before exporting a snapshot.'
            : 'Export the current read-only controller settings snapshot.'
        }
        onClick={props.model.exportCurrent}
        disabled={props.model.rowsCount === 0}
      >
        Export current snapshot
      </button>
    </div>
  );
}

function SnapshotSlots(props: { readonly model: SnapshotCompareModel }): JSX.Element {
  return (
    <div style={slotGridStyle}>
      <SnapshotSlot
        label="A"
        snapshot={props.model.left}
        onLoad={() => props.model.loadSlot('A')}
        onClear={() => props.model.clearSlot('A')}
      />
      <SnapshotSlot
        label="B"
        snapshot={props.model.right}
        onLoad={() => props.model.loadSlot('B')}
        onClear={() => props.model.clearSlot('B')}
      />
    </div>
  );
}

function SnapshotSlot(props: {
  readonly label: SnapshotSlotId;
  readonly snapshot: ControllerSettingsSnapshot | null;
  readonly onLoad: () => void;
  readonly onClear: () => void;
}): JSX.Element {
  return (
    <section aria-label={`Snapshot ${props.label}`} style={slotStyle}>
      <strong>Snapshot {props.label}</strong>
      {props.snapshot === null ? (
        <span style={mutedStyle}>No file loaded</span>
      ) : (
        <span style={slotDetailStyle}>
          {props.snapshot.operatorLabel}
          <br />
          Profile context: {props.snapshot.profile.name}
          <br />
          Captured: {new Date(props.snapshot.capturedAt).toLocaleString()}
        </span>
      )}
      <div style={buttonRowStyle}>
        <button
          type="button"
          title={`Load a controller settings file into snapshot ${props.label}.`}
          onClick={props.onLoad}
        >
          Load {props.label}
        </button>
        <button
          type="button"
          title={
            props.snapshot === null
              ? `Snapshot ${props.label} is already empty.`
              : `Clear snapshot ${props.label} from this comparison.`
          }
          onClick={props.onClear}
          disabled={props.snapshot === null}
        >
          Clear
        </button>
      </div>
    </section>
  );
}

function SnapshotComparisonResults(props: {
  readonly model: SnapshotCompareModel;
}): JSX.Element | null {
  const { left, right, comparison } = props.model;
  if (left === null || right === null) return null;
  const differenceCount = comparison.filter((row) => row.status !== 'equivalent').length;
  return (
    <>
      <div style={compareHeadingStyle}>
        <strong>
          {differenceCount} {differenceCount === 1 ? 'difference' : 'differences'} across{' '}
          {comparison.length} {comparison.length === 1 ? 'setting' : 'settings'}
        </strong>
        <label>
          <input
            type="checkbox"
            title="Include settings whose values are equivalent in both snapshots."
            checked={props.model.showEquivalent}
            onChange={(event) => props.model.setShowEquivalent(event.target.checked)}
          />{' '}
          Show matching values
        </label>
      </div>
      <SnapshotComparisonTable model={props.model} left={left} right={right} />
      <p style={safetyNoteStyle}>
        This comparison cannot diagnose belts, pinions, frame stiffness, motor current, or lost
        steps. Use it to choose the next controlled test, not to certify a cause.
      </p>
    </>
  );
}

function SnapshotComparisonTable(props: {
  readonly model: SnapshotCompareModel;
  readonly left: ControllerSettingsSnapshot;
  readonly right: ControllerSettingsSnapshot;
}): JSX.Element {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cellStyle}>Setting</th>
            <th style={cellStyle}>{props.left.operatorLabel}</th>
            <th style={cellStyle}>{props.right.operatorLabel}</th>
            <th style={cellStyle}>Delta B - A</th>
            <th style={cellStyle}>Result</th>
          </tr>
        </thead>
        <tbody>
          {props.model.visibleComparison.length === 0 ? (
            <tr>
              <td colSpan={5} style={cellStyle}>
                All loaded values are equivalent.
              </td>
            </tr>
          ) : (
            props.model.visibleComparison.map((row) => (
              <ComparisonRow key={row.id} row={row} name={props.model.names.get(row.id)} />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ComparisonRow(props: {
  readonly row: SnapshotComparison;
  readonly name: string | undefined;
}): JSX.Element {
  return (
    <tr>
      <td style={cellStyle}>
        <strong>{props.row.code}</strong> {props.name ?? 'Unknown setting'}
      </td>
      <td style={valueCellStyle}>{props.row.leftRawValue ?? 'missing'}</td>
      <td style={valueCellStyle}>{props.row.rightRawValue ?? 'missing'}</td>
      <td style={valueCellStyle}>{formatDelta(props.row.delta, props.row.percentDeltaFromLeft)}</td>
      <td style={cellStyle}>{comparisonLabel(props.row.status)}</td>
    </tr>
  );
}

async function saveCurrentSnapshot(input: {
  readonly platform: PlatformAdapter;
  readonly profile: DeviceProfile;
  readonly rows: ReadonlyArray<GrblSettingRow>;
  readonly active: ControllerKind;
  readonly detected: ControllerKind | null;
  readonly label: string;
}): Promise<string | null> {
  const snapshot = createControllerSettingsSnapshot({
    capturedAt: new Date().toISOString(),
    operatorLabel: input.label,
    profile: { profileId: input.profile.profileId ?? null, name: input.profile.name },
    controllerKinds: {
      profile: input.profile.controllerKind ?? null,
      active: input.active,
      detected: input.detected,
    },
    settings: input.rows,
  });
  const target = await input.platform.pickFileForSave({
    suggestedName: `${fileSafeLabel(input.label)}-controller-settings.lfsettings.json`,
    extensions: ['.lfsettings.json'],
  });
  if (target === null) return null;
  await target.write(serializeControllerSettingsSnapshot(snapshot));
  return `Exported read-only snapshot to ${target.displayName}.`;
}

async function loadSnapshot(platform: PlatformAdapter): Promise<ControllerSettingsSnapshot | null> {
  const [file] = await platform.pickFilesForOpen({
    accept: ['.lfsettings.json', '.json'],
    multiple: false,
  });
  if (file === undefined) return null;
  if (file.size !== undefined && file.size > MAX_SNAPSHOT_BYTES) {
    throw new Error('Snapshot exceeds the 2 MB safety limit.');
  }
  const text = await file.text();
  if (new Blob([text]).size > MAX_SNAPSHOT_BYTES) {
    throw new Error('Snapshot exceeds the 2 MB safety limit.');
  }
  const parsed = deserializeControllerSettingsSnapshot(text);
  if (parsed.kind === 'ok') return parsed.snapshot;
  if (parsed.kind === 'schema-too-new') {
    throw new Error(`Snapshot schema ${parsed.sawVersion} is newer than this app supports.`);
  }
  if (parsed.kind === 'schema-too-old') {
    throw new Error(`Snapshot schema ${parsed.sawVersion} is no longer supported.`);
  }
  throw new Error(parsed.reason);
}

function settingNames(
  left: ControllerSettingsSnapshot | null,
  right: ControllerSettingsSnapshot | null,
): ReadonlyMap<number, string> {
  const result = new Map<number, string>();
  for (const snapshot of [left, right]) {
    if (snapshot === null) continue;
    for (const row of controllerSettingsSnapshotToRows(snapshot)) result.set(row.id, row.name);
  }
  return result;
}

function formatDelta(delta: number | null, percent: number | null): string {
  if (delta === null) return '-';
  const signed = delta > 0 ? `+${delta}` : String(delta);
  if (percent === null) return signed;
  return `${signed} (${percent > 0 ? '+' : ''}${percent.toFixed(1)}%)`;
}

function comparisonLabel(status: SnapshotComparison['status']): string {
  switch (status) {
    case 'equivalent':
      return 'Equivalent';
    case 'different':
      return 'Different';
    case 'missing-left':
      return 'Missing from A';
    case 'missing-right':
      return 'Missing from B';
  }
}

function fileSafeLabel(label: string): string {
  const safe = label
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
  return safe === '' ? 'controller' : safe;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
