import type { ReliefHeightfieldMapping } from '../../core/scene/relief';

const SECTION_MARGIN_BOTTOM_PX = 8;
const TEXT_FONT_SIZE_PX = 11;
const HEADING_FONT_WEIGHT = 600;
const TEXT_LINE_HEIGHT = 1.25;
const LIST_GAP_PX = 3;
const ROW_GAP_PX = 2;
const HEADING_MARGIN = '0 0 4px 0';
const DETAIL_MARGIN = '5px 0 0 0';

type AspectCopy = {
  readonly label: string;
  readonly description: string;
};

const ASPECT_COPY: Readonly<Record<ReliefHeightfieldMapping['aspect'], AspectCopy>> = {
  preserve: {
    label: 'Preserve',
    description:
      'Width edits preserve the current canonical physical aspect when the derived Height rounds to a positive finite value.',
  },
  stretch: {
    label: 'Stretch',
    description:
      'Width and Height are resolved independently; Width edits retain the current canonical Height.',
  },
};

/** Discloses the resolved canonical editor aspect policy without adding another transform. */
export function ReliefResolvedAspectDisclosure(props: {
  readonly aspect: ReliefHeightfieldMapping['aspect'];
}): JSX.Element {
  const copy = ASPECT_COPY[props.aspect];
  return (
    <section aria-label="Resolved aspect policy" style={sectionStyle}>
      <h4 style={headingStyle}>Resolved aspect policy</h4>
      <dl style={listStyle}>
        <div style={rowStyle}>
          <dt style={labelStyle}>{copy.label}</dt>
          <dd style={valueStyle}>{copy.description}</dd>
        </div>
      </dl>
      <p style={detailStyle}>This is recorded/resolved editor policy, not another CAM transform.</p>
    </section>
  );
}

const sectionStyle: React.CSSProperties = { marginBottom: SECTION_MARGIN_BOTTOM_PX };
const headingStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: TEXT_FONT_SIZE_PX,
  fontWeight: HEADING_FONT_WEIGHT,
  margin: HEADING_MARGIN,
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
};
const detailStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontSize: TEXT_FONT_SIZE_PX,
  lineHeight: TEXT_LINE_HEIGHT,
  margin: DETAIL_MARGIN,
};
