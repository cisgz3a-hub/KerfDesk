import { useState } from 'react';
import { materialTestAxisValues } from '../../core/job/material-test-axes';
import { Button, Dialog, DialogActions } from '../kit';
import {
  MaterialTestAxisRow,
  MaterialTestFixedFields,
  MaterialTestLayoutFields,
  MaterialTestModeField,
  MaterialTestPlacementField,
  type MaterialTestFieldSetter,
} from './MaterialTestAxisFields';
import {
  materialTestDraftIssues,
  materialTestRequest,
  numberValue,
  persistMaterialTestDraft,
  restoreMaterialTestDraft,
  withAxisParameter,
  type MaterialTestDraft,
  type MaterialTestRequest,
} from './material-test-draft';

export function MaterialTestDialog(props: {
  readonly onCancel: () => void;
  readonly onGenerate: (request: MaterialTestRequest) => void;
  readonly maxFeedMmPerMin: number;
}): JSX.Element {
  const [draft, setDraft] = useState(restoreMaterialTestDraft);
  const issues = materialTestDraftIssues(draft);
  const update = (key: keyof MaterialTestDraft, value: string): void =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setField: MaterialTestFieldSetter = (key) => (event) => update(key, event.target.value);
  // kit Dialog adds the Escape/focus-trap behavior these two dialogs were
  // missing (every other modal had it via use-dialog-a11y).
  return (
    <Dialog
      onClose={props.onCancel}
      title="Material Test"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (issues.length > 0) return;
        persistMaterialTestDraft(draft);
        props.onGenerate(materialTestRequest(draft));
      }}
      size="md"
    >
      <MaterialTestModeField draft={draft} setField={setField} />
      {(['row', 'column'] as const).map((axis) => (
        <MaterialTestAxisRow
          key={axis}
          axis={axis}
          draft={draft}
          setField={setField}
          onParameterChange={(parameter) =>
            setDraft((current) => withAxisParameter(current, axis, parameter))
          }
        />
      ))}
      <MaterialTestFixedFields
        draft={draft}
        setField={setField}
        onAirAssistChange={(on) => update('airAssist', on ? 'on' : 'off')}
      />
      <MaterialTestLayoutFields
        draft={draft}
        setField={setField}
        onToggle={(key, on) => update(key, on ? 'on' : 'off')}
      />
      <MaterialTestPlacementField
        placement={draft.placement}
        onChange={(placement) => update('placement', placement)}
      />
      {issues.length > 0 ? <p role="alert">{issues.join(' ')}</p> : null}
      <MaterialTestSummary
        draft={draft}
        valid={issues.length === 0}
        maxFeedMmPerMin={props.maxFeedMmPerMin}
      />
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={issues.length > 0}>
          Generate
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Cell count, then the requested and effective feed range: the profile
// ceiling caps fast speeds, and the burned labels show what actually ran.
function MaterialTestSummary(props: {
  readonly draft: MaterialTestDraft;
  readonly valid: boolean;
  readonly maxFeedMmPerMin: number;
}): JSX.Element {
  const feeds = feedRange(props.draft);
  const effectiveLow = Math.min(feeds.low, props.maxFeedMmPerMin);
  const effectiveHigh = Math.min(feeds.high, props.maxFeedMmPerMin);
  return (
    <p role="status" style={statusStyle}>
      {props.valid ? `${gridSize(props.draft)} ` : null}
      Requested {formatRange(feeds.low, feeds.high)} mm/min; effective{' '}
      {formatRange(effectiveLow, effectiveHigh)} mm/min with the active profile ceiling of{' '}
      {formatFeed(props.maxFeedMmPerMin)} mm/min.
      {feeds.fromAxis && props.draft.labels !== 'off'
        ? ' Burned speed labels show effective feed.'
        : null}
    </p>
  );
}

// A passes axis holds one step per whole pass, so it can hold fewer steps
// than the count asks for; the size shown is the grid that will be made.
function gridSize(draft: MaterialTestDraft): string {
  const { options } = materialTestRequest(draft);
  const rows = materialTestAxisValues(options.rowAxis, options.mode).length;
  const columns = materialTestAxisValues(options.columnAxis, options.mode).length;
  return `${rows} × ${columns} = ${rows * columns} cells.`;
}

function feedRange(draft: MaterialTestDraft): {
  readonly low: number;
  readonly high: number;
  readonly fromAxis: boolean;
} {
  const axis =
    draft.rowParameter === 'speed'
      ? [draft.rowStart, draft.rowEnd]
      : draft.columnParameter === 'speed'
        ? [draft.columnStart, draft.columnEnd]
        : null;
  const values = (axis ?? [draft.speed]).map(numberValue);
  return { low: Math.min(...values), high: Math.max(...values), fromAxis: axis !== null };
}

function formatRange(low: number, high: number): string {
  return low === high ? formatFeed(low) : `${formatFeed(low)}–${formatFeed(high)}`;
}

function formatFeed(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '0';
}

const statusStyle: React.CSSProperties = {
  margin: '12px 0 0',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
