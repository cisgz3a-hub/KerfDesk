// One label/value row in a Job Review fact list (dt/dd, recovery-dialog
// pattern). Warning tone flags values the operator should glance at twice.

import { factRowStyle, factTermStyle } from './job-review.styles';

export function JobReviewFactRow(props: {
  readonly label: string;
  readonly tone?: 'default' | 'warning';
  readonly isDimmed?: boolean;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={factRowStyle}>
      <dt style={factTermStyle}>{props.label}</dt>
      <dd style={valueStyle(props.tone ?? 'default', props.isDimmed === true)}>{props.children}</dd>
    </div>
  );
}

function valueStyle(tone: 'default' | 'warning', isDimmed: boolean): React.CSSProperties {
  return {
    margin: 0,
    overflowWrap: 'anywhere',
    color: tone === 'warning' ? 'var(--lf-warning-fg)' : undefined,
    opacity: isDimmed ? 0.55 : 1,
  };
}
