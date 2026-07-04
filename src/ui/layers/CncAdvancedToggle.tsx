// CncAdvancedToggle — the Basic/Advanced switch for the CNC layer cards
// (ADR-111). Beginner default is Basic; flipping this reveals the advanced
// fields (feeds, stepover, pocket fill, cut-type tails) on every CNC layer
// card and persists across sessions. CNC-only.

import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';

export function CncAdvancedToggle(): JSX.Element | null {
  const isCnc = useStore((s) => machineKindOf(s.project.machine) === 'cnc');
  const showAdvanced = useUiStore((s) => s.showCncAdvanced);
  const setShowAdvanced = useUiStore((s) => s.setShowCncAdvanced);
  if (!isCnc) return null;
  return (
    <label
      style={rowStyle}
      title="Show every cut setting. Off keeps the layer cards to the essentials."
    >
      <input
        type="checkbox"
        checked={showAdvanced}
        onChange={(e) => setShowAdvanced(e.target.checked)}
        aria-label="Show advanced cut settings"
        title="Show every cut setting. Off keeps the layer cards to the essentials."
      />
      <span>Advanced cut settings</span>
    </label>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  margin: '4px 0',
};
