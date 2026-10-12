// What Two-Point Rotate / Scale wants next, shown while it is on, with the
// turn and scale the next click would apply.

import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { twoPointMotion } from './two-point-tool';

export function TwoPointHint(): JSX.Element | null {
  const mode = useUiStore((state) => (state.toolMode.kind === 'two-point' ? state.toolMode : null));
  const resetToolMode = useUiStore((state) => state.resetToolMode);
  const cursor = useStore((state) => state.cursorMm);
  if (mode === null) return null;
  const motion =
    mode.pivot !== undefined && mode.from !== undefined && cursor !== null
      ? twoPointMotion(mode.pivot, mode.from, cursor, true)
      : null;
  const prompt =
    mode.pivot === undefined
      ? 'Two-Point Rotate / Scale: click the pivot, the point everything turns about.'
      : mode.from === undefined
        ? 'Click a reference point on the artwork.'
        : `Click where that point goes${motion === null ? '' : `: turn ${motion.deltaDeg.toFixed(2)}°, with Shift scale ×${motion.scale.toFixed(4)}`}.`;
  return (
    <div role="status" style={hintStyle}>
      <span>{prompt}</span>
      <button
        type="button"
        className="lf-btn"
        onClick={resetToolMode}
        title="Cancel and return to the Select tool (Esc)."
      >
        Cancel
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
