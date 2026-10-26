import { BooleanResultModeFields } from './BooleanResultModeFields';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  isVectorPathObject,
  type VectorOpError,
  type VectorSceneObject,
} from '../../core/geometry';
import {
  describeWeldChange,
  NOTHING_TO_WELD_MESSAGE,
  type WeldChange,
} from '../../core/geometry/vector-path-weld-change';
import type { Result } from '../../core/result';
import { artworkOperationName, type ImportedSvg } from '../../core/scene';
import { useStore } from '../state';
import { selectedObjectIds } from '../state/scene-group-actions';
import type { PreparedVectorCombine } from '../state/vector-op-prepared';
import { uniqueObjectId, uniqueWeldId } from '../state/vector-path-selection';
import {
  finishWeldSelection,
  prepareWeldSelection,
  type WeldSelectionPlan,
} from '../state/vector-path-weld-plan';
import { Button, Dialog, DialogActions } from '../kit';
import { useVectorOpPreview } from './use-vector-op-preview';
import type { VectorOpTask } from './vector-op-worker-protocol';
import { VectorComparisonPreview } from './VectorComparisonPreview';
import {
  useBooleanDialogStore,
  type BooleanSession,
  type BooleanPreviewOperation,
} from './boolean-dialog-store';

export function BooleanDialogHost(): JSX.Element | null {
  const session = useBooleanDialogStore((state) => state.session);
  return session === null ? null : (
    <BooleanDialog
      key={`${session.documentEpoch}-${session.operation}-${session.ids.join('-')}`}
      session={session}
    />
  );
}
function BooleanDialog({ session }: { readonly session: BooleanSession }): JSX.Element {
  const {
    operation,
    setOperation,
    keepOperands,
    setKeepOperands,
    retainCompound,
    setRetainCompound,
    sources,
    preview,
    after,
    absorbed,
    updating,
    canApply,
    unchanged,
    apply,
    close,
  } = useBooleanReview(session);
  return (
    <Dialog
      title="Combine Shapes"
      size="sm"
      as="form"
      onClose={close}
      onSubmit={(event) => {
        event.preventDefault();
        if (unchanged && canApply) apply();
      }}
    >
      <label className="lf-field">
        <span>Operation</span>
        <select
          className="lf-input"
          aria-label="Boolean operation"
          title="Preview an operation before applying it to this selection."
          value={operation}
          onChange={(event) => setOperation(event.currentTarget.value as BooleanPreviewOperation)}
        >
          <option value="weld">Weld within each operation</option>
          <option value="subtract">Subtract</option>
          <option value="intersect">Intersect</option>
          <option value="exclude">Exclude</option>
        </select>
      </label>
      <p>
        {operation === 'weld'
          ? 'Weld preserves separate operations and settings.'
          : `Subject: ${sources[0] === undefined ? 'none' : artworkOperationName(sources[0])}. The bottom-most selected artwork is the subject.`}
      </p>
      <VectorComparisonPreview
        before={sources}
        after={after}
        label="Boolean operation before and after"
      />
      <BooleanResultModeFields
        keep={keepOperands}
        retain={retainCompound}
        setKeep={setKeepOperands}
        setRetain={setRetainCompound}
      />
      {absorbed.length > 0 ? <p role="alert">{absorbedWarning(absorbed)}</p> : null}
      <p role="status" aria-live="polite">
        {booleanReviewStatus(unchanged, updating, preview.problem, keepOperands)}
      </p>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!unchanged || !canApply}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function useBooleanReview(session: BooleanSession) {
  const [operation, changeOperation] = useState(session.operation);
  const [keepOperands, changeKeepOperands] = useState(false);
  const [retainCompound, changeRetainCompound] = useState(false);
  const revision = useRef(0);
  const setOperation = (value: BooleanPreviewOperation): void => {
    revision.current += 1;
    setSubmitted(false);
    changeOperation(value);
  };
  const setKeepOperands = (value: boolean): void => {
    revision.current += 1;
    setSubmitted(false);
    changeKeepOperands(value);
    if (value) changeRetainCompound(false);
  };
  const setRetainCompound = (value: boolean): void => {
    revision.current += 1;
    setSubmitted(false);
    changeRetainCompound(value);
    if (value) changeKeepOperands(false);
  };
  const [submitted, setSubmitted] = useState(false);
  const currentProject = useStore((state) => state.project);
  const epoch = useStore((state) => state.projectDocumentEpoch);
  const primary = useStore((state) => state.selectedObjectId);
  const additional = useStore((state) => state.additionalSelectedIds);
  const close = useBooleanDialogStore((state) => state.close);
  const { sources, preview, after, absorbed } = useBooleanPreview(session, operation);
  const ids = selectedObjectIds({ selectedObjectId: primary, additionalSelectedIds: additional });
  const unchanged =
    currentProject === session.project &&
    epoch === session.documentEpoch &&
    ids.length === session.ids.length &&
    session.ids.every((id) => ids.includes(id));
  useEffect(() => {
    if (submitted && currentProject !== session.project) close();
  }, [submitted, currentProject, session, close]);
  const apply = (): void => {
    const state = useStore.getState();
    if (!booleanSessionIsCurrent(session)) return;
    setSubmitted(true);
    const requestRevision = ++revision.current;
    const isCurrent = (): boolean => {
      return booleanSessionIsCurrent(session) && revision.current === requestRevision;
    };
    const options = {
      keepOperands,
      retainCompound,
      expectedProject: session.project,
      expectedIds: session.ids,
      isCurrent,
      ...(preview.prepared === undefined ? {} : { prepared: preview.prepared }),
    };
    if (operation === 'weld') state.weldSelection(options);
    else state.booleanSelection(operation, options);
    if (useStore.getState().project !== session.project) close();
  };
  return {
    operation,
    setOperation,
    keepOperands,
    setKeepOperands,
    retainCompound,
    setRetainCompound,
    sources,
    preview,
    after,
    absorbed,
    updating: preview.updating,
    canApply: preview.canApply,
    unchanged,
    apply,
    close,
  };
}

function booleanSessionIsCurrent(session: BooleanSession): boolean {
  const state = useStore.getState();
  const ids = selectedObjectIds(state);
  return (
    useBooleanDialogStore.getState().session === session &&
    state.project === session.project &&
    state.projectDocumentEpoch === session.documentEpoch &&
    ids.length === session.ids.length &&
    session.ids.every((id) => ids.includes(id))
  );
}

type BooleanPreviewState = {
  /** The current operation's error, or the reason the background preview cannot run. */
  readonly problem: string | null;
  readonly updating: boolean;
  readonly canApply: boolean;
  readonly prepared: PreparedVectorCombine | undefined;
};

// The union runs in the vector worker (ADR-609) with the ids Apply will use, so
// Apply commits the settled result instead of computing it again on this thread.
function useBooleanPreview(session: BooleanSession, operation: BooleanPreviewOperation) {
  const scene = session.project.scene;
  const sources = useMemo(
    () =>
      scene.objects.filter(
        (object): object is VectorSceneObject =>
          session.ids.includes(object.id) && isVectorPathObject(object) && object.locked !== true,
      ),
    [scene, session.ids],
  );
  const weld = useMemo(
    () => (operation === 'weld' ? prepareWeldSelection(scene, sources, uniqueWeldId(scene)) : null),
    [scene, sources, operation],
  );
  const task = useMemo<VectorOpTask>(
    () =>
      weld === null
        ? {
            kind: 'combine',
            op: operation as Exclude<BooleanPreviewOperation, 'weld'>,
            id: uniqueObjectId(scene, operation),
          }
        : { kind: 'weld', id: weld.resultId },
    [scene, operation, weld],
  );
  const vector = useVectorOpPreview(weld === null ? sources : weld.operands, task);
  const settled = vector.current?.result as Result<ImportedSvg, VectorOpError> | undefined;
  const result: Result<ImportedSvg | WeldSelectionPlan, VectorOpError> | undefined =
    settled === undefined || weld === null ? settled : finishWeldSelection(weld, settled);
  const weldChange = useMemo<WeldChange | null>(
    () =>
      weld !== null && settled?.kind === 'ok' ? describeWeldChange(sources, settled.value) : null,
    [weld, settled, sources],
  );
  const preview: BooleanPreviewState = {
    ...previewStatus(result, vector.unavailable, vector.failed, weldChange),
    prepared: preparedCombine(session, sources, task, result),
  };
  // The last settled result stays visible, marked as updating, while the next one runs.
  const shown = vector.settled?.result as Result<ImportedSvg, VectorOpError> | undefined;
  const after = useMemo(() => (shown?.kind === 'ok' ? [shown.value] : []), [shown]);
  const absorbed = useMemo(
    () => sources.filter((source) => weldChange?.absorbedIds.includes(source.id) === true),
    [sources, weldChange],
  );
  return { sources, preview, after, absorbed };
}

function previewStatus(
  result: Result<unknown, VectorOpError> | undefined,
  unavailable: string | null,
  failed: string | null,
  weldChange: WeldChange | null,
): Omit<BooleanPreviewState, 'prepared'> {
  if (weldChange?.changed === false) {
    return { problem: NOTHING_TO_WELD_MESSAGE, updating: false, canApply: false };
  }
  if (result !== undefined) {
    return {
      problem: result.kind === 'error' ? result.error.message : null,
      updating: false,
      canApply: result.kind === 'ok',
    };
  }
  // Work that ran and failed is not retried in thread (ADR-609).
  if (failed !== null) return { problem: failed, updating: false, canApply: false };
  // Where the background preview cannot run, Apply computes in thread as before.
  if (unavailable !== null) {
    return { problem: `${unavailable} Apply still works.`, updating: false, canApply: true };
  }
  return { problem: null, updating: true, canApply: false };
}

function preparedCombine(
  session: BooleanSession,
  sources: ReadonlyArray<VectorSceneObject>,
  task: VectorOpTask,
  result: Result<ImportedSvg | WeldSelectionPlan, VectorOpError> | undefined,
): PreparedVectorCombine | undefined {
  if (result?.kind !== 'ok') return undefined;
  const value = result.value;
  if ('object' in value) {
    return { kind: 'weld', scene: session.project.scene, sources, plan: value };
  }
  return task.kind === 'combine'
    ? { kind: 'combine', sources, op: task.op, object: value }
    : undefined;
}

function absorbedWarning(absorbed: ReadonlyArray<VectorSceneObject>): string {
  const names = absorbed.map((object) => `“${artworkOperationName(object)}”`).join(', ');
  return absorbed.length === 1
    ? `${names} lies entirely inside another shape in the same operation, so Weld removes it.`
    : `${names} lie entirely inside other shapes in the same operation, so Weld removes them.`;
}

function booleanReviewStatus(
  unchanged: boolean,
  updating: boolean,
  problem: string | null,
  keep: boolean,
): string {
  if (!unchanged) return 'The project or selection changed. Close and reopen this preview.';
  if (updating) return 'Updating preview…';
  if (problem !== null) return problem;
  return keep
    ? 'Apply adds the result. Source objects remain in the job.'
    : 'Apply replaces the source objects. Undo restores them.';
}
