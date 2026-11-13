// The CNC operations the compile cut another way than they ask for, named in
// Preview before anything is saved or started (performance audit S8-P2-1).
export function PreviewCncFallbackBanner(props: {
  readonly notices: ReadonlyArray<string>;
  readonly style: React.CSSProperties;
  /** Accessible name; tile registration reuses this banner. */
  readonly label?: string;
}): JSX.Element | null {
  if (props.notices.length === 0) return null;
  return (
    <div
      className="lf-banner lf-banner--warning"
      style={props.style}
      role="status"
      aria-label={props.label ?? 'Operations cut differently'}
    >
      {props.notices.map((notice) => (
        <div key={notice}>{notice}</div>
      ))}
    </div>
  );
}
