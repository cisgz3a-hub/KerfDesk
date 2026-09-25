// Clickable preview of a Material Test (ADR-381): one button per burned cell,
// laid out like the physical test with its row and column values, shaded by
// the energy each cell put into the material so the preview reads like the
// burn. Arrow keys move between cells; only the chosen cell is a tab stop.

import type { CSSProperties, KeyboardEvent } from 'react';
import {
  materialTestBurnedSettings,
  materialTestRelativeEnergy,
  type MaterialTestCellResult,
  type MaterialTestResult,
} from '../../core/job/material-test-cells';
import type { LayerOperationSettings } from '../../core/scene';
import {
  axisCaption,
  axisValueText,
  cellName,
  settingsSummary,
} from './material-test-results-format';

const MIN_SHADE = 0.12;

type GridModel = {
  readonly test: MaterialTestResult;
  readonly burned: ReadonlyMap<string, LayerOperationSettings>;
  readonly shade: ReadonlyMap<string, number>;
  readonly byPosition: ReadonlyMap<string, MaterialTestCellResult>;
  readonly selectedId: string | null;
  readonly focusId: string | null;
  readonly onSelect: (objectId: string) => void;
};

export function MaterialTestCellGrid(props: {
  readonly test: MaterialTestResult;
  readonly maxFeedMmPerMin: number | undefined;
  readonly selectedId: string | null;
  readonly onSelect: (objectId: string) => void;
}): JSX.Element {
  const { test } = props;
  const burned = new Map(
    test.cells.map((cell) => [
      cell.objectId,
      materialTestBurnedSettings(cell, props.maxFeedMmPerMin),
    ]),
  );
  const model: GridModel = {
    test,
    burned,
    shade: shades(test.cells, burned),
    byPosition: new Map(test.cells.map((cell) => [positionKey(cell.row, cell.column), cell])),
    selectedId: props.selectedId,
    focusId: props.selectedId ?? test.cells[0]?.objectId ?? null,
    onSelect: props.onSelect,
  };
  return (
    <div>
      <p style={captionStyle}>
        Rows: {axisCaption(test.rowParameter)} · Columns: {axisCaption(test.columnParameter)}
      </p>
      <div
        role="grid"
        aria-label={`${test.name} cells`}
        style={{
          ...gridStyle,
          gridTemplateColumns: `auto repeat(${test.columns}, minmax(14px, 1fr))`,
        }}
        onKeyDown={(event) => moveWithArrows(event, model)}
      >
        <HeaderRow model={model} />
        {Array.from({ length: test.rows }, (_, row) => (
          <BodyRow key={row} model={model} row={row} />
        ))}
      </div>
    </div>
  );
}

function HeaderRow(props: { readonly model: GridModel }): JSX.Element {
  const { test, burned } = props.model;
  return (
    <div role="row" style={rowStyle}>
      <span role="columnheader" />
      {Array.from({ length: test.columns }, (_, column) => {
        const cell = test.cells.find((candidate) => candidate.column === column);
        const settings = cell === undefined ? undefined : burned.get(cell.objectId);
        return (
          <span key={column} role="columnheader" style={headerStyle}>
            {axisValueText(test.columnParameter, settings, column)}
          </span>
        );
      })}
    </div>
  );
}

function BodyRow(props: { readonly model: GridModel; readonly row: number }): JSX.Element {
  const { test, burned, shade, byPosition } = props.model;
  const first = test.cells.find((candidate) => candidate.row === props.row);
  const rowSettings = first === undefined ? undefined : burned.get(first.objectId);
  return (
    <div role="row" style={rowStyle}>
      <span role="rowheader" style={headerStyle}>
        {axisValueText(test.rowParameter, rowSettings, props.row)}
      </span>
      {Array.from({ length: test.columns }, (_, column) => {
        const cell = byPosition.get(positionKey(props.row, column));
        if (cell === undefined) return <span key={column} role="gridcell" />;
        const settings = burned.get(cell.objectId);
        return (
          <CellButton
            key={column}
            cell={cell}
            label={`${cellName(test, cell)}: ${settings === undefined ? '' : settingsSummary(settings)}`}
            shade={shade.get(cell.objectId) ?? MIN_SHADE}
            selected={cell.objectId === props.model.selectedId}
            focusable={cell.objectId === props.model.focusId}
            onSelect={props.model.onSelect}
          />
        );
      })}
    </div>
  );
}

function CellButton(props: {
  readonly cell: MaterialTestCellResult;
  readonly label: string;
  readonly shade: number;
  readonly selected: boolean;
  readonly focusable: boolean;
  readonly onSelect: (objectId: string) => void;
}): JSX.Element {
  // The shade is data (this cell's relative energy), so it is inline per the
  // ADR-047 dynamic-styles policy; the color itself is a theme token.
  const percent = Math.round(props.shade * 100);
  return (
    <span role="gridcell" style={cellWrapStyle}>
      <button
        type="button"
        data-cell-id={props.cell.objectId}
        aria-label={props.label}
        aria-pressed={props.selected}
        title={props.label}
        tabIndex={props.focusable ? 0 : -1}
        onClick={() => props.onSelect(props.cell.objectId)}
        style={{
          ...cellStyle,
          background: `color-mix(in srgb, var(--lf-accent) ${percent}%, transparent)`,
          outline: props.selected ? '2px solid var(--lf-accent-fg)' : 'none',
        }}
      />
    </span>
  );
}

function moveWithArrows(event: KeyboardEvent<HTMLDivElement>, model: GridModel): void {
  const step = ARROW_STEPS[event.key];
  const current = model.test.cells.find((cell) => cell.objectId === model.focusId);
  if (step === undefined || current === undefined) return;
  const next = model.byPosition.get(
    positionKey(current.row + step.row, current.column + step.column),
  );
  if (next === undefined) return;
  event.preventDefault();
  model.onSelect(next.objectId);
  event.currentTarget
    .querySelector<HTMLButtonElement>(`[data-cell-id="${next.objectId}"]`)
    ?.focus();
}

// Log-scaled so a tenfold energy range still shows every step.
function shades(
  cells: ReadonlyArray<MaterialTestCellResult>,
  burned: ReadonlyMap<string, LayerOperationSettings>,
): ReadonlyMap<string, number> {
  const energies = cells.map((cell) => {
    const settings = burned.get(cell.objectId);
    const energy = settings === undefined ? 0 : materialTestRelativeEnergy(settings);
    return Math.log(Math.max(energy, 1e-12));
  });
  const low = Math.min(...energies);
  const high = Math.max(...energies);
  return new Map(
    cells.map((cell, index) => {
      const t = high > low ? ((energies[index] ?? low) - low) / (high - low) : 0.5;
      return [cell.objectId, MIN_SHADE + (1 - MIN_SHADE) * t];
    }),
  );
}

function positionKey(row: number, column: number): string {
  return `${row}:${column}`;
}

const ARROW_STEPS: Readonly<
  Partial<Record<string, { readonly row: number; readonly column: number }>>
> = {
  ArrowUp: { row: -1, column: 0 },
  ArrowDown: { row: 1, column: 0 },
  ArrowLeft: { row: 0, column: -1 },
  ArrowRight: { row: 0, column: 1 },
};

const captionStyle: CSSProperties = {
  margin: '0 0 6px',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const gridStyle: CSSProperties = { display: 'grid', gap: 2, alignItems: 'center' };
// Rows are layout-transparent so their cells sit in the parent grid.
const rowStyle: CSSProperties = { display: 'contents' };
const headerStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--lf-text-muted)',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  padding: '0 2px',
};
const cellWrapStyle: CSSProperties = { display: 'block' };
const cellStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  aspectRatio: '1',
  minHeight: 14,
  padding: 0,
  border: '1px solid var(--lf-border-strong)',
  borderRadius: 2,
  cursor: 'pointer',
  outlineOffset: 1,
};
