import type { ReactNode } from 'react';

interface Props {
  readonly label: string;
  readonly title?: string;
  readonly children: ReactNode;
}

export function CollapsibleRailSection({ label, title, children }: Props): JSX.Element {
  return (
    <details style={sectionStyle}>
      <summary style={summaryStyle} title={title}>
        {label}
      </summary>
      <div style={contentStyle}>{children}</div>
    </details>
  );
}

const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  padding: '6px 8px',
};
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontWeight: 600 };
const contentStyle: React.CSSProperties = { marginTop: 8 };
