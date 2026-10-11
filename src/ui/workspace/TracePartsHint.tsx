import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { activateTracePartTool } from './trace-part-tool';
import { useTracePartSelection } from './use-trace-part-selection';
import './trace-parts.css';

export function TracePartsHint(): JSX.Element | null {
  const mode = useUiStore((state) => state.toolMode.kind);
  const hasTrace = useStore((state) => {
    const selected = state.project.scene.objects.find(
      (object) => object.id === state.selectedObjectId,
    );
    return selected?.kind === 'traced-image' && selected.locked !== true;
  });
  const preview = useStore((state) => state.previewMode);
  const active = mode === 'trace-parts';
  useTracePartSelection(active && !preview);
  if (preview || (!active && (mode !== 'select' || !hasTrace))) return null;
  return (
    <div role="status" className="lf-trace-parts-hint">
      <span>
        {active
          ? 'Drag a traced line or shape. Shift-click adds parts. Arrow keys nudge; Delete removes. Holes stay with their outline.'
          : 'Move a single part of this trace, or reshape its nodes.'}
      </span>
      {active ? (
        <button
          type="button"
          className="lf-btn"
          onClick={() => useUiStore.getState().resetToolMode()}
        >
          Done
        </button>
      ) : (
        <button type="button" className="lf-btn" onClick={activateTracePartTool}>
          Edit trace parts
        </button>
      )}
      {hasTrace ? (
        <button
          type="button"
          className="lf-btn"
          onClick={() => useUiStore.getState().setToolMode({ kind: 'node' })}
        >
          {active ? 'Edit part nodes' : 'Edit nodes'}
        </button>
      ) : null}
    </div>
  );
}
