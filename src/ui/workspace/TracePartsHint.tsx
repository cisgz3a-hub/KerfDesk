import { useStore } from '../state/store';
import { useUiStore, type ToolMode } from '../state/ui-store';
import { activateTracePartTool } from './trace-part-tool';
import { retryTracePartPreparation } from './trace-part-preparation';
import { useTracePartPreparationStatus } from './trace-part-preparation-store';
import { useTracePartSelection } from './use-trace-part-selection';
import { NodeEditHint } from './NodeEditHint';
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
  const preparation = useTracePartPreparationStatus();
  const active = mode === 'trace-parts';
  const editingNodes = mode === 'node';
  const editing = active || editingNodes;
  useTracePartSelection(active && !preview);
  if (preview || (!editing && (mode !== 'select' || !hasTrace))) return null;
  return (
    <div
      role="status"
      className="lf-trace-parts-hint"
      aria-busy={active && preparation.status === 'preparing'}
    >
      {editing ? <strong>{editingNodes ? 'Editing nodes' : 'Editing trace parts'}</strong> : null}
      {editing ? (
        <button
          type="button"
          className="lf-btn"
          aria-label={editingNodes ? 'Done editing nodes' : 'Done editing trace parts'}
          title="Keep completed edits and return to Select (Esc)."
          onClick={() => useUiStore.getState().resetToolMode()}
        >
          Done
        </button>
      ) : null}
      <EditingHint mode={mode} preparation={preparation} />
      <TraceActions
        editing={editing}
        hasTrace={hasTrace}
        mode={mode}
        preparationFailed={preparation.status === 'error'}
      />
    </div>
  );
}

function EditingHint({
  mode,
  preparation,
}: {
  readonly mode: ToolMode['kind'];
  readonly preparation: ReturnType<typeof useTracePartPreparationStatus.getState>;
}): JSX.Element {
  if (mode === 'node') return <NodeEditHint />;
  return <span>{traceEditingHint(mode, preparation)}</span>;
}

function traceEditingHint(
  mode: ToolMode['kind'],
  preparation: ReturnType<typeof useTracePartPreparationStatus.getState>,
): string {
  if (mode === 'trace-parts') {
    if (preparation.status === 'preparing') {
      return 'Preparing trace parts… You can pan or choose Done while this runs.';
    }
    if (preparation.status === 'error') {
      return preparation.message ?? 'Could not prepare trace parts. Choose Retry to try again.';
    }
    return 'Drag a traced line or shape. Shift-click adds parts. Arrow keys nudge; Delete removes. Holes stay with their outline. Esc cancels a drag; press Esc again or choose Done to finish.';
  }
  return 'Move a single part of this trace, or reshape its nodes.';
}

function TraceActions({
  editing,
  hasTrace,
  mode,
  preparationFailed,
}: {
  readonly editing: boolean;
  readonly hasTrace: boolean;
  readonly mode: ToolMode['kind'];
  readonly preparationFailed: boolean;
}): JSX.Element {
  return (
    <>
      {mode === 'trace-parts' && preparationFailed ? (
        <button
          type="button"
          className="lf-btn"
          title="Try preparing trace parts again so you can pick and move them."
          onClick={retryTracePartPreparation}
        >
          Retry
        </button>
      ) : null}
      {!editing ? (
        <button
          type="button"
          className="lf-btn"
          title="Pick and move individual traced lines or shapes while keeping their holes."
          onClick={activateTracePartTool}
        >
          Edit trace parts
        </button>
      ) : null}
      {hasTrace && mode !== 'node' ? (
        <button
          type="button"
          className="lf-btn"
          title="Reshape the selected trace by moving its nodes and curve handles."
          onClick={() => useUiStore.getState().setToolMode({ kind: 'node' })}
        >
          {mode === 'trace-parts' ? 'Edit part nodes' : 'Edit nodes'}
        </button>
      ) : null}
    </>
  );
}
