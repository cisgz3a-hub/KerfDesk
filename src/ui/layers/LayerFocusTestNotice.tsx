import type { Layer } from '../../core/scene';
import { useStore } from '../state';

/** Focus Test samples carry relative Z moves that no other field shows. */
export function LayerFocusTestNotice(props: { readonly layer: Layer }): JSX.Element | null {
  const removeLayerFocusTest = useStore((state) => state.removeLayerFocusTest);
  const focus = props.layer.focusTest;
  if (focus === undefined) return null;
  const offset = `${focus.offsetMm >= 0 ? '+' : ''}${focus.offsetMm.toFixed(3)}`;
  return (
    <div role="note" aria-label={`Focus Test Z for ${props.layer.name}`} style={noticeStyle}>
      <span>
        Focus Test: Z {offset} mm. Artwork on this operation moves Z relative to the starting focus.
      </span>
      <button
        type="button"
        className="lf-btn lf-btn--ghost"
        title="Make this an ordinary operation without Focus Test Z moves (undoable)"
        onClick={() => removeLayerFocusTest(props.layer.id)}
      >
        Remove Focus Test Z
      </button>
    </div>
  );
}

const noticeStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  marginTop: 6,
  padding: '4px 6px',
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  background: 'var(--lf-tint-warning)',
  fontSize: 'var(--lf-text-sm)',
};
