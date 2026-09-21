import type { ReactNode } from 'react';

interface Props {
  readonly label: string;
  readonly title?: string;
  readonly children: ReactNode;
}

export function CollapsibleRailSection({ label, title, children }: Props): JSX.Element {
  return (
    <details className="lf-machine-disclosure" style={sectionStyle}>
      <summary style={summaryStyle} title={title}>
        {label}
      </summary>
      <div style={contentStyle}>{children}</div>
    </details>
  );
}

const sectionStyle: React.CSSProperties = {
  borderTop: '1px solid var(--lf-border)',
  padding: '9px 0',
  fontSize: 'var(--lf-text-sm)',
};
const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontWeight: 500,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.4,
};
const contentStyle: React.CSSProperties = { marginTop: 8 };
