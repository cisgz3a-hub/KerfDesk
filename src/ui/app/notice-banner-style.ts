// Styles for the warning banners above the workspace: the opened-machine
// notice and the imported G-code preview.
//
// The words and the buttons share one row while both fit, and the buttons
// drop beneath the words on a narrow window. Without the wrap the buttons
// never shrink, so on a phone-width window the words were squeezed into a
// column one word wide. The opened-machine notice names everything another
// machine brings (ADR-440 Amendment 8), and that column grew taller than the
// window, leaving the workspace rails and their tabs under the status bar.

export const noticeBannerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 12px',
  borderBottom: '1px solid var(--lf-warning-border)',
  background: 'var(--lf-warning-bg)',
  color: 'var(--lf-text)',
  fontSize: 12,
};

/** The words take the row; below about 20 em beside the buttons they wrap above them. */
export const noticeBannerTextStyle: React.CSSProperties = {
  flex: '1 1 20em',
  minWidth: 0,
};

export const noticeBannerActionsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};
