// What the Trim Shapes tool does, shown while it is on (LBG-T04), in the same
// place and style as the laser tab tool's hint.

import { useUiStore } from '../state/ui-store';

export const TRIM_SHAPES_HINT =
  'Trim Shapes: hover an outline to highlight the stretch between its nearest crossings, then click to delete it. An outline that crosses nothing is deleted whole. Each click can be undone.';

export function TrimShapesHint(): JSX.Element | null {
  const active = useUiStore((state) => state.toolMode.kind === 'trim-shapes');
  const resetToolMode = useUiStore((state) => state.resetToolMode);
  if (!active) return null;
  return (
    <div role="status" style={hintStyle}>
      <span>{TRIM_SHAPES_HINT}</span>
      <button
        type="button"
        className="lf-btn"
        onClick={resetToolMode}
        title="Stop trimming and return to the Select tool (Esc)."
      >
        Done
      </button>
    </div>
  );
}

const hintStyle: React.CSSProperties = {
  position: 'absolute',
  left: 12,
  bottom: 52,
  zIndex: 8,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  maxWidth: 'min(460px, calc(100% - 24px))',
  padding: '8px 12px',
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  color: 'var(--lf-text)',
  background: 'var(--lf-bg-1)',
  boxShadow: 'var(--lf-shadow)',
  fontSize: 12,
};
