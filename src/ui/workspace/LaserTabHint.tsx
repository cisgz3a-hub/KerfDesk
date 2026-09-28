// What the laser tab tool does, shown while it is active (ADR-494). The Cut
// Settings dialog that opens the tool closes behind it, so this is where the
// operator reads how it works and leaves it.

import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';

export function LaserTabHint(): JSX.Element | null {
  const mode = useUiStore((state) => state.toolMode);
  const resetToolMode = useUiStore((state) => state.resetToolMode);
  const clearTabs = useStore((state) => state.clearSelectedLaserTabAnchors);
  const placed = useStore((state) => {
    if (mode.kind !== 'laser-tabs') return 0;
    const object = state.project.scene.objects.find((item) => item.id === state.selectedObjectId);
    return (object?.laserTabAnchors ?? []).filter((anchor) => anchor.layerColor === mode.layerColor)
      .length;
  });
  if (mode.kind !== 'laser-tabs') return null;
  return (
    <div role="status" style={hintStyle}>
      <span>
        Click the outline to add a tab, click a tab to remove it, or drag a tab to move it. Placed
        tabs replace the automatic ones on their shape. {placed} placed.
      </span>
      <button
        type="button"
        className="lf-btn"
        disabled={placed === 0}
        onClick={() => clearTabs(mode.layerColor)}
        title="Remove the tabs placed by hand so the artwork gets automatic tabs again."
      >
        Clear placed tabs
      </button>
      <button
        type="button"
        className="lf-btn"
        onClick={resetToolMode}
        title="Stop placing tabs and return to the Select tool (Esc)."
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
