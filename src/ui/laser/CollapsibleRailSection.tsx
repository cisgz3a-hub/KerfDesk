import type { ReactNode } from 'react';

interface Props {
  readonly label: string;
  readonly title?: string;
  readonly children: ReactNode;
  // Mirrors the native disclosure state for a parent that mounts costly
  // content only while the section is open. The <details> stays uncontrolled.
  readonly onOpenChange?: (open: boolean) => void;
}

export function CollapsibleRailSection({
  label,
  title,
  children,
  onOpenChange,
}: Props): JSX.Element {
  return (
    <details
      className="lf-machine-disclosure"
      style={sectionStyle}
      onToggle={
        onOpenChange === undefined ? undefined : (event) => onOpenChange(event.currentTarget.open)
      }
    >
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
