import type { ReliefHeightfieldProvenance } from '../../core/scene/relief';

const NOT_RECORDED = 'Not recorded';

const SOURCE_POLARITY_LABELS: Readonly<
  Record<NonNullable<ReliefHeightfieldProvenance['sourcePolarity']>, string>
> = {
  'light-is-high': 'Light is high',
  'light-is-deep': 'Light is deep',
};

type RecordedSourceRow = {
  readonly label: string;
  readonly value: string;
};

/** Shows the exact recorded source metadata of a canonical relief without editing it. */
export function ReliefRecordedSourceDetails(props: {
  readonly provenance: ReliefHeightfieldProvenance;
}): JSX.Element {
  const rows = recordedSourceRows(props.provenance);
  return (
    <section aria-label="Relief recorded source details" style={sectionStyle}>
      <h4 style={headingStyle}>Recorded source details</h4>
      <p style={explanationStyle}>Recorded metadata is not authenticated.</p>
      <dl style={listStyle}>
        {rows.map((row) => (
          <div key={row.label} style={rowStyle}>
            <dt style={labelStyle}>{row.label}</dt>
            <dd style={valueStyle}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function recordedSourceRows(
  provenance: ReliefHeightfieldProvenance,
): ReadonlyArray<RecordedSourceRow> {
  return [
    { label: 'Source name', value: recordedString(provenance.sourceName) },
    {
      label: 'Source bit depth',
      value:
        provenance.sourceBitDepth === undefined ? NOT_RECORDED : `${provenance.sourceBitDepth}-bit`,
    },
    {
      label: 'Recorded source polarity',
      value:
        provenance.sourcePolarity === undefined
          ? NOT_RECORDED
          : SOURCE_POLARITY_LABELS[provenance.sourcePolarity],
    },
    { label: 'Producer name', value: recordedString(provenance.producer?.name) },
    { label: 'Producer model', value: recordedString(provenance.producer?.model) },
    { label: 'Producer version', value: recordedString(provenance.producer?.version) },
  ];
}

function recordedString(value: string | undefined): string {
  return value === undefined || value.trim() === '' ? NOT_RECORDED : value;
}

const sectionStyle: React.CSSProperties = { marginBottom: 8 };
const headingStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  fontWeight: 600,
  margin: '0 0 4px 0',
};
const explanationStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontSize: 11,
  lineHeight: 1.25,
  margin: '0 0 5px 0',
};
const listStyle: React.CSSProperties = { display: 'grid', gap: 3, margin: 0 };
const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '112px minmax(0, 1fr)',
  gap: 8,
};
const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 11 };
const valueStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontSize: 11,
  margin: 0,
  overflowWrap: 'anywhere',
};
