import { useUiStore } from '../state/ui-store';

export function ArtworkNumberingPrompt(): JSX.Element | null {
  const numbering = useUiStore((state) => state.artworkNumbering);
  if (numbering.kind !== 'active') return null;
  return (
    <div role="status" style={promptStyle}>
      Click artwork for run #{numbering.nextPosition}
      <span style={hintStyle}>Use the Run order panel to undo, finish, or cancel.</span>
    </div>
  );
}

const promptStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 8,
  pointerEvents: 'none',
  padding: '8px 12px',
  border: '1px solid var(--lf-accent)',
  borderRadius: 6,
  color: 'var(--lf-text)',
  background: 'var(--lf-bg-1)',
  boxShadow: 'var(--lf-shadow)',
  fontWeight: 700,
  textAlign: 'center',
};
const hintStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 2,
  color: 'var(--lf-text-muted)',
  fontSize: 10,
  fontWeight: 400,
};
