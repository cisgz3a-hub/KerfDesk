import { useState } from 'react';
import type { ArtworkRunOrderRowModel } from './artwork-run-order-view-model';

// Re-seed after every move attempt, including a move that the store refuses.
// The input stays uncontrolled so typing is never fought mid-edit.
function RunPositionInput(props: {
  readonly rowKey: string;
  readonly position: number;
  readonly name: string;
  readonly disabled: boolean;
  readonly total?: number;
  readonly onMove: (position: number) => void;
}): JSX.Element {
  const [moveAttempt, setMoveAttempt] = useState(0);
  return (
    <input
      key={`${props.rowKey}:${props.position}:${moveAttempt}`}
      type="number"
      min={1}
      max={props.total}
      step={1}
      defaultValue={props.position}
      disabled={props.disabled}
      aria-label={`Run position for ${props.name}`}
      title={
        props.disabled
          ? 'Finish or cancel canvas numbering to change this run number'
          : 'Enter a run number, then press Enter or leave this field to move it'
      }
      className="lf-run-order-position-input"
      onBlur={(event) => {
        const typed = Number(event.currentTarget.value);
        setMoveAttempt((value) => value + 1);
        if (!props.disabled) props.onMove(typed);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

type ArtworkRunOrderRowProps = {
  readonly row: ArtworkRunOrderRowModel;
  readonly active: boolean;
  readonly showSettings?: boolean;
  readonly machineKind: 'laser' | 'cnc';
  readonly total?: number;
  readonly numberingActive?: boolean;
  readonly onFocus: () => void;
  readonly onMove: (position: number) => void;
  readonly onEditSettings: () => void;
};

export function ArtworkRunOrderRow(props: ArtworkRunOrderRowProps): JSX.Element {
  const accent = props.row.colors[0] ?? 'var(--lf-accent)';
  const numberingActive = props.numberingActive ?? false;
  const steps = effectiveOrderText(props.row, props.machineKind);
  return (
    <article
      aria-label={`Run ${props.row.position}: ${props.row.name}`}
      aria-current={props.active ? 'true' : undefined}
      className={runCardClassName(props.active, props.showSettings ?? false, steps !== null)}
      style={{ borderLeftColor: accent }}
      onClick={props.onFocus}
    >
      <div className="lf-run-order-card-heading">
        <span className="lf-run-order-badge" aria-label={`Run number ${props.row.position}`}>
          <span aria-hidden="true">#</span>
          {props.row.position}
        </span>
        <button
          type="button"
          className="lf-run-order-identity"
          title={`Select ${props.row.name} on the canvas`}
          aria-label={`Select ${props.row.name}`}
          aria-pressed={props.active}
          onClick={(event) => {
            event.stopPropagation();
            props.onFocus();
          }}
        >
          <strong>{props.row.name}</strong>
          <span>
            {props.row.kindLabel} · {props.row.dimensions}
          </span>
        </button>
      </div>
      <RunCardSummary row={props.row} showSettings={props.showSettings ?? false} />
      {steps === null ? null : (
        <div className="lf-run-order-effective" tabIndex={0}>
          {steps}
        </div>
      )}
      <div className="lf-run-order-card-actions" onClick={stopPropagation}>
        <label className="lf-run-order-position">
          <span>Move to</span>
          <RunPositionInput
            rowKey={props.row.key}
            position={props.row.position}
            name={props.row.name}
            disabled={numberingActive}
            {...(props.total === undefined ? {} : { total: props.total })}
            onMove={props.onMove}
          />
        </label>
        <button
          type="button"
          title={
            numberingActive
              ? 'Finish or cancel canvas numbering to edit settings'
              : `Edit settings for ${props.row.name}`
          }
          className="lf-btn lf-btn--ghost"
          disabled={numberingActive}
          onClick={props.onEditSettings}
        >
          Edit settings
        </button>
      </div>
    </article>
  );
}

function runCardClassName(active: boolean, detailed: boolean, hasSteps: boolean): string {
  return [
    'lf-run-order-card',
    ...(active ? ['lf-run-order-card--active'] : []),
    ...(detailed ? ['lf-run-order-card--detailed'] : []),
    ...(hasSteps ? [] : ['lf-run-order-card--no-steps']),
  ].join(' ');
}

// The title already names an artwork whose operation shares its name, so the
// operation line appears only when it says something new (ADR-616).
function RunCardSummary(props: {
  readonly row: ArtworkRunOrderRowModel;
  readonly showSettings: boolean;
}): JSX.Element {
  const { row } = props;
  const operation = row.operationSummary === row.name ? null : row.operationSummary;
  const empty = operation === null && !props.showSettings && !row.shared;
  return (
    <div
      className="lf-run-order-summary"
      {...(empty ? {} : { tabIndex: 0, 'aria-label': `Settings summary for ${row.name}` })}
    >
      {operation === null ? null : <strong>{operation}</strong>}
      {props.showSettings ? <span>{row.settingsSummary}</span> : null}
      {row.shared ? <span>Shared by {row.objectIds.length} artworks</span> : null}
    </div>
  );
}

// A laser run whose one output step is its own run number says nothing the #N
// badge does not (ADR-616). CNC always shows its steps: clearing before
// profiles can move them away from the requested number (ADR-211).
function effectiveOrderText(
  row: Pick<ArtworkRunOrderRowModel, 'effectiveSteps' | 'output' | 'position'>,
  machineKind: 'laser' | 'cnc',
): string | null {
  const steps = row.effectiveSteps;
  if (!row.output) return 'Output off · This artwork will not run';
  if (steps.length === 0) return 'Output on · Output steps are unavailable';
  if (machineKind === 'laser' && steps.length === 1 && steps[0] === row.position) return null;
  const label = stepRanges(steps);
  return machineKind === 'cnc'
    ? `Actual CNC step${steps.length === 1 ? '' : 's'}: ${label}`
    : `Laser output step${steps.length === 1 ? '' : 's'}: ${label}`;
}

// Preserve every effective output step while keeping consecutive runs readable.
function stepRanges(steps: ReadonlyArray<number>): string {
  const ranges: string[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const first = steps[index];
    if (first === undefined) continue;
    let last = first;
    let next = steps[index + 1];
    while (next !== undefined && next === last + 1) {
      index += 1;
      last = next;
      next = steps[index + 1];
    }
    ranges.push(last === first ? `${first}` : `${first}–${last}`);
  }
  return ranges.join(', ');
}

function stopPropagation(event: React.MouseEvent): void {
  event.stopPropagation();
}
