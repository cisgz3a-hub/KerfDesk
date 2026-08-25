import type { ReliefHeightfieldSourceKind } from '../../core/scene/relief';

type SourceMeaningPresentation = {
  readonly label: string;
  readonly description: string;
};

const SOURCE_MEANINGS: Readonly<Record<ReliefHeightfieldSourceKind, SourceMeaningPresentation>> = {
  'depth-map': {
    label: 'Depth map',
    description: 'Declared scalar depth data.',
  },
  'brightness-emboss': {
    label: 'Brightness emboss',
    description: 'Artistic emboss — not recovered 3D geometry.',
  },
  'relative-depth-map': {
    label: 'Relative-depth map',
    description: 'Relative depth — not millimetres; map its range to physical depth.',
  },
  'editable-relief-map': {
    label: 'Editable relief map',
    description: 'Operator-authored scalar data.',
  },
  'stl-top-projection': {
    label: 'STL top projection',
    description: 'Top projection only; undercuts are not represented.',
  },
};

/** Shows a persisted heightfield declaration or the source-arm truth of a legacy STL relief. */
export function ReliefSourceMeaning(props: {
  readonly sourceKind: ReliefHeightfieldSourceKind;
}): JSX.Element {
  const presentation = SOURCE_MEANINGS[props.sourceKind];
  return (
    <div role="group" aria-label="Relief declared source meaning" style={rowStyle}>
      <span style={labelStyle}>Declared source meaning</span>
      <span style={meaningStyle}>
        <strong style={nameStyle}>{presentation.label}</strong>
        <span style={descriptionStyle}>{presentation.description}</span>
      </span>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '92px 1fr',
  alignItems: 'start',
  gap: 8,
  marginBottom: 8,
};
const labelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const meaningStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const nameStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600 };
const descriptionStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  fontSize: 11,
  lineHeight: 1.25,
};
