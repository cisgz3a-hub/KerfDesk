// Instructions for the endpoint Extend tool.

import { useUiStore } from '../state/ui-store';

export const EXTEND_SHAPES_HINT =
  'Extend Shapes: hover an open endpoint, then click to extend to the nearest boundary ahead. No boundary means no change. Curves continue with a straight tangent. Each click can be undone.';

export function ExtendShapesHint(): JSX.Element | null {
  const active = useUiStore((state) => state.toolMode.kind === 'extend-shapes');
  const resetToolMode = useUiStore((state) => state.resetToolMode);
  if (!active) return null;
  return (
    <div role="status" style={hintStyle}>
      <span>{EXTEND_SHAPES_HINT}</span>
      <button
        type="button"
        className="lf-btn"
        onClick={resetToolMode}
        title="Stop extending and return to the Select tool (Esc)."
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
