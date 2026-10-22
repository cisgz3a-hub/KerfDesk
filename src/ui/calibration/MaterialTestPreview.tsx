// The Material Test dialog's live picture of the card Generate will burn:
// every row and column it holds, labelled with the burned values, each cell
// shaded by its energy from faint to deep. Engraved cells fill; cut cells
// show only their outline. The last valid card stays, dimmed, while a field
// is invalid. Cell proportions are physical; matrix spacing is schematic so
// every axis label stays readable. Display only: nothing here reaches output.

import { useRef, type CSSProperties, type SVGProps } from 'react';
import type { MaterialTestGridOptions } from '../../core/job/material-test-grid';
import {
  materialTestPreview,
  type MaterialTestPreviewAxis,
  type MaterialTestPreviewCell,
  type MaterialTestPreviewModel,
} from './material-test-preview';

const PITCH_MIN = 11;
const PITCH_MAX = 22;
const GRID_MAX_WIDTH = 280;
const GRID_MAX_HEIGHT = 180;
const FONT_MAX = 10;
// Numerals and separators average a little under 0.6 em.
const CHAR_WIDTH_EM = 0.6;
const LABEL_PAD = 4;

type Layout = {
  readonly pitch: number;
  readonly font: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Column labels turn upright when side by side they would overlap. */
  readonly uprightColumns: boolean;
};

export function MaterialTestPreview(props: {
  /** The grid options Generate would use, or null while a field is invalid. */
  readonly options: MaterialTestGridOptions | null;
  /** The active profile's maximum feed, which caps the speeds the job runs. */
  readonly maxFeedMmPerMin: number;
}): JSX.Element {
  const last = useRef<MaterialTestPreviewModel | null>(null);
  if (props.options !== null) {
    last.current = materialTestPreview({
      ...props.options,
      maxFeedMmPerMin: props.maxFeedMmPerMin,
    });
  }
  const model = last.current;
  const stale = props.options === null;
  if (model === null) {
    return <p style={emptyStyle}>The test card preview appears once every field above is valid.</p>;
  }
  const label = stale
    ? `Test card preview, paused until every field is valid. Last valid card: ${model.summary}`
    : `Test card preview. ${model.summary}`;
  const proportions = `Cells: ${model.cellWidth} × ${model.cellHeight} mm. Cell proportions shown; spacing is schematic.`;
  return (
    <div
      role="img"
      aria-label={`${label} ${proportions}`}
      style={{ ...frameStyle, opacity: stale ? 0.35 : 1 }}
    >
      <PreviewHeader model={model} />
      <PreviewGrid model={model} />
      <div style={noteStyle}>{proportions}</div>
    </div>
  );
}

function PreviewHeader(props: { readonly model: MaterialTestPreviewModel }): JSX.Element {
  const { rows, columns } = props.model;
  return (
    <div style={headerStyle}>
      <span>
        <span style={axisKeyStyle}>↓ {axisTitle(rows)}</span>
        <span style={axisKeyStyle}>→ {axisTitle(columns)}</span>
      </span>
      <span style={legendStyle}>
        Faint
        <span style={legendBarStyle} />
        Deep
      </span>
    </div>
  );
}

function PreviewGrid(props: { readonly model: MaterialTestPreviewModel }): JSX.Element {
  const { model } = props;
  const layout = previewLayout(model);
  const { pitch, left, top, font } = layout;
  const size = pitch - Math.max(1, pitch * 0.12);
  return (
    <svg
      width={layout.width}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      style={svgStyle}
      fontSize={font}
      fill="var(--lf-text-muted)"
    >
      <g data-part="column-labels">
        {model.columns.labels.map((text, column) => {
          const x = left + column * pitch + size / 2;
          const y = top - LABEL_PAD;
          const placement: SVGProps<SVGTextElement> = layout.uprightColumns
            ? { transform: `rotate(-90 ${x} ${y})`, dominantBaseline: 'central' }
            : { textAnchor: 'middle' };
          return (
            <text key={column} x={x} y={y} {...placement}>
              {text}
            </text>
          );
        })}
      </g>
      <g data-part="row-labels" textAnchor="end" dominantBaseline="central">
        {model.rows.labels.map((text, row) => (
          <text key={row} x={left - LABEL_PAD} y={top + row * pitch + size / 2}>
            {text}
          </text>
        ))}
      </g>
      <g data-part="cells">
        {model.cells.map((cell) => (
          <PreviewCell
            key={`${cell.row}-${cell.column}`}
            cell={cell}
            model={model}
            x={left + cell.column * pitch}
            y={top + cell.row * pitch}
            size={size}
          />
        ))}
      </g>
    </svg>
  );
}

function PreviewCell(props: {
  readonly cell: MaterialTestPreviewCell;
  readonly model: MaterialTestPreviewModel;
  readonly x: number;
  readonly y: number;
  readonly size: number;
}): JSX.Element {
  const { cell, model, size } = props;
  const shade = cell.energy > 0 ? burnShade(cell.energy) : 'var(--lf-bg-input)';
  const cut = model.mode === 'line';
  // Fit the physical shape uniformly inside its labelled matrix slot. The
  // stroke stays inside that footprint, without thickening subpixel strips.
  const scale = size / Math.max(model.cellWidth, model.cellHeight);
  const width = model.cellWidth * scale;
  const height = model.cellHeight * scale;
  const outline = Math.min(cut ? 1 : 0.75, width / 3, height / 3);
  return (
    <rect
      x={props.x + (size - width + outline) / 2}
      y={props.y + (size - height + outline) / 2}
      width={width - outline}
      height={height - outline}
      rx={Math.min(1.5, width / 4, height / 4)}
      fill={cut ? 'var(--lf-bg-input)' : shade}
      stroke={cut && cell.energy > 0 ? shade : 'var(--lf-border)'}
      strokeWidth={outline}
    >
      <title>{cellTitle(cell, model)}</title>
    </rect>
  );
}

function previewLayout(model: MaterialTestPreviewModel): Layout {
  const rows = model.rows.labels.length;
  const columns = model.columns.labels.length;
  const pitch = Math.max(
    PITCH_MIN,
    Math.min(PITCH_MAX, GRID_MAX_WIDTH / columns, GRID_MAX_HEIGHT / rows),
  );
  const font = Math.min(FONT_MAX, pitch - 1);
  const charWidth = font * CHAR_WIDTH_EM;
  const columnLabelWidth = longest(model.columns.labels) * charWidth;
  const uprightColumns = columnLabelWidth + LABEL_PAD > pitch;
  const left = longest(model.rows.labels) * charWidth + 2 * LABEL_PAD;
  const top = (uprightColumns ? columnLabelWidth : font) + 2 * LABEL_PAD;
  return {
    pitch,
    font,
    left,
    top,
    width: Math.ceil(left + columns * pitch),
    height: Math.ceil(top + rows * pitch),
    uprightColumns,
  };
}

// Copper over the input ground: a faint burn stays visible, the deepest is
// full strength. Both tokens follow the theme.
function burnShade(energy: number): string {
  const percent = Math.round(12 + 88 * Math.min(1, Math.max(0, energy)));
  return `color-mix(in srgb, var(--lf-accent-fg) ${percent}%, var(--lf-bg-input))`;
}

function cellTitle(cell: MaterialTestPreviewCell, model: MaterialTestPreviewModel): string {
  const value = (axis: MaterialTestPreviewAxis, index: number): string =>
    `${axis.name} ${withUnit(axis.labels[index] ?? '', axis)}`;
  const share = Math.round(cell.energy * 100);
  return (
    `${capitalize(value(model.rows, cell.row))}, ${value(model.columns, cell.column)}: ` +
    `${share}% of the deepest burn's energy`
  );
}

function axisTitle(axis: MaterialTestPreviewAxis): string {
  return axis.unit === '' ? capitalize(axis.name) : `${capitalize(axis.name)} (${axis.unit})`;
}

function withUnit(text: string, axis: MaterialTestPreviewAxis): string {
  if (axis.unit === '') return text;
  return axis.unit === '%' ? `${text}%` : `${text} ${axis.unit}`;
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function longest(labels: ReadonlyArray<string>): number {
  return labels.reduce((max, text) => Math.max(max, text.length), 1);
}

const frameStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  marginTop: 12,
  padding: 8,
  background: 'var(--lf-bg-input)',
  border: '1px solid var(--lf-border)',
  borderRadius: 'var(--lf-radius-md)',
};
const headerStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  gap: '4px 12px',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
const axisKeyStyle: CSSProperties = { marginRight: 12, whiteSpace: 'nowrap' };
const noteStyle: CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
const legendStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
};
const legendBarStyle: CSSProperties = {
  display: 'inline-block',
  width: 56,
  height: 8,
  borderRadius: 2,
  border: '1px solid var(--lf-border)',
  background: `linear-gradient(90deg, ${burnShade(0)}, ${burnShade(1)})`,
};
const svgStyle: CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  height: 'auto',
  margin: '0 auto',
  fontVariantNumeric: 'tabular-nums',
  overflow: 'visible',
};
const emptyStyle: CSSProperties = {
  margin: '12px 0 0',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
