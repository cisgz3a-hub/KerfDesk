export function MainThreadInspectionNotice(): JSX.Element {
  return (
    <p role="status" style={noticeStyle}>
      The background preview worker could not start. This G-code was parsed on the main UI thread,
      so the app may be unresponsive while large files are prepared.
    </p>
  );
}

const noticeStyle: React.CSSProperties = {
  margin: '8px 12px',
  color: 'var(--lf-warning)',
  fontSize: 12,
};
