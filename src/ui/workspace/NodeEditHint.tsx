import type { SceneObject } from '../../core/scene';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';

export function NodeEditHint(): JSX.Element | null {
  const mode = useUiStore((state) => state.toolMode);
  const previewMode = useStore((state) => state.previewMode);
  const objects = useStore((state) => state.project.scene.objects);
  const selectedId = useStore((state) => state.selectedObjectId);
  const additionalIds = useStore((state) => state.additionalSelectedIds);
  const convert = useStore((state) => state.convertSelectionToPath);
  if (mode.kind !== 'node' || previewMode) return null;
  const selection = objects.filter(
    (object) => object.id === selectedId || additionalIds.has(object.id),
  );
  if (selection.length === 0 || !selection.every(needsPathConversion)) return null;
  const instruction =
    selection.length === 1
      ? `Convert the ${primitiveName(selection[0])} to a path to edit its nodes.`
      : 'Convert the selected shapes to paths to edit their nodes.';
  return (
    <div role="status" style={hintStyle}>
      <span>{instruction}</span>
      <button
        type="button"
        className="lf-btn"
        onClick={convert}
        title="Replace the selected shapes or text with editable paths."
      >
        Convert to Path
      </button>
    </div>
  );
}

function needsPathConversion(object: SceneObject): boolean {
  if (object.locked === true) return false;
  return object.kind === 'text' || (object.kind === 'shape' && object.spec.kind !== 'polyline');
}

function primitiveName(object: SceneObject | undefined): string {
  if (object?.kind === 'text') return 'text';
  if (object?.kind !== 'shape') return 'shape';
  return object.spec.kind === 'rect' ? 'rectangle' : object.spec.kind;
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
  maxWidth: 'min(420px, calc(100% - 24px))',
  padding: '8px 12px',
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  color: 'var(--lf-text)',
  background: 'var(--lf-bg-1)',
  boxShadow: 'var(--lf-shadow)',
  fontSize: 12,
};
