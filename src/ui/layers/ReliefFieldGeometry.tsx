import type { Transform } from '../../core/scene';
import type { ReliefHeightfield } from '../../core/scene/relief';
import { reliefFieldGeometryDisplay } from './relief-field-geometry-display';

const BOTH_AXES_COUNT = 2;
const SECTION_MARGIN_BOTTOM_PX = 8;
const TEXT_FONT_SIZE_PX = 11;
const HEADING_FONT_WEIGHT = 600;
const TEXT_LINE_HEIGHT = 1.25;
const LIST_GAP_PX = 3;
const ROW_GAP_PX = 2;
const HEADING_MARGIN = '0 0 4px 0';
const EXPLANATION_MARGIN = '0 0 5px 0';
const DETAIL_MARGIN = '5px 0 0 0';

/** Shows canonical source sampling geometry without presenting it as a CAM or preview grid. */
export function ReliefFieldGeometry(props: {
  readonly source: ReliefHeightfield;
  readonly transform: Transform;
}): JSX.Element {
  const geometry = reliefFieldGeometryDisplay(props.source, props.transform);
  return (
    <section aria-label="Relief field geometry" style={sectionStyle}>
      <h4 style={headingStyle}>Field geometry</h4>
      <p style={explanationStyle}>
        Relief-axis magnitudes after object scale. Rotation and mirrors change orientation, not
        these values.
      </p>
      <dl style={listStyle}>
        <GeometryRow
          label="Physical size (relief W × H)"
          value={`${formatPair(geometry.widthMm, geometry.heightMm)} mm`}
        />
        <GeometryRow
          label="Nominal full source-cell pitch (relief X × Y)"
          value={`${formatPair(geometry.pitchXMm, geometry.pitchYMm)} mm/cell`}
        />
      </dl>
      <p style={detailStyle}>
        Pitch includes the current crop. Cropped edge source cells can be smaller; when a crop
        includes only part of one source cell, nominal pitch can exceed the physical span. Source
        sampling only—not preview or CAM spacing. Values round to six significant decimal digits
        with insignificant trailing zeros omitted; very large or small finite results use scientific
        notation.
      </p>
      {geometry.collapsedAxes.length > 0 ? (
        <p role="note" style={collapsedStyle}>
          Zero-scale compatibility: {collapsedAxisCopy(geometry.collapsedAxes)} collapsed after
          planning, so physical carving geometry on {collapsedPronoun(geometry.collapsedAxes)} is
          not qualified.
        </p>
      ) : null}
    </section>
  );
}

function GeometryRow(props: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div style={rowStyle}>
      <dt style={labelStyle}>{props.label}</dt>
      <dd style={valueStyle}>{props.value}</dd>
    </div>
  );
}

function formatPair(x: string, y: string): string {
  return `${x} × ${y}`;
}

function collapsedAxisCopy(axes: ReadonlyArray<'X' | 'Y'>): string {
  return axes.length === BOTH_AXES_COUNT
    ? 'the X and Y relief axes are'
    : `the ${axes[0]} relief axis is`;
}

function collapsedPronoun(axes: ReadonlyArray<'X' | 'Y'>): string {
  return axes.length === BOTH_AXES_COUNT ? 'those axes' : 'that axis';
}

const sectionStyle: React.CSSProperties = { marginBottom: SECTION_MARGIN_BOTTOM_PX };
const headingStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: TEXT_FONT_SIZE_PX,
  fontWeight: HEADING_FONT_WEIGHT,
  margin: HEADING_MARGIN,
};
const explanationStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontSize: TEXT_FONT_SIZE_PX,
  lineHeight: TEXT_LINE_HEIGHT,
  margin: EXPLANATION_MARGIN,
};
const listStyle: React.CSSProperties = { display: 'grid', gap: LIST_GAP_PX, margin: 0 };
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: ROW_GAP_PX,
};
const labelStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: TEXT_FONT_SIZE_PX,
};
const valueStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontSize: TEXT_FONT_SIZE_PX,
  margin: 0,
  overflowWrap: 'anywhere',
};
const detailStyle: React.CSSProperties = { ...explanationStyle, margin: DETAIL_MARGIN };
const collapsedStyle: React.CSSProperties = {
  ...explanationStyle,
  color: 'var(--lf-warning-fg)',
  margin: DETAIL_MARGIN,
};
