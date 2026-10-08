import { BooleanResultModeFields } from './BooleanResultModeFields';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  combineVectorObjects,
  isVectorPathObject,
  type VectorSceneObject,
} from '../../core/geometry';
import { artworkOperationName } from '../../core/scene';
import { useStore } from '../state';
import { selectedObjectIds } from '../state/scene-group-actions';
import { planWeldSelection } from '../state/vector-path-weld-plan';
import { Button, Dialog, DialogActions } from '../kit';
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
    deferredOperation,
    sources,
    preview,
    after,
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
        if (unchanged && deferredOperation === operation && preview.kind === 'ok') apply();
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
      <p role="status" aria-live="polite">
        {booleanReviewStatus(
          unchanged,
          deferredOperation !== operation,
          preview.kind === 'error' ? preview.error.message : null,
          keepOperands,
        )}
      </p>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="primary"
          type="submit"
          disabled={!unchanged || deferredOperation !== operation || preview.kind !== 'ok'}
        >
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
  const deferredOperation = useDeferredValue(operation);
  const currentProject = useStore((state) => state.project);
  const epoch = useStore((state) => state.projectDocumentEpoch);
  const primary = useStore((state) => state.selectedObjectId);
  const additional = useStore((state) => state.additionalSelectedIds);
  const close = useBooleanDialogStore((state) => state.close);
  const { sources, preview, after } = useBooleanPreview(session, deferredOperation);
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
    deferredOperation,
    sources,
    preview,
    after,
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

function useBooleanPreview(session: BooleanSession, deferredOperation: BooleanPreviewOperation) {
  const sources = useMemo(
    () =>
      session.project.scene.objects.filter(
        (object): object is VectorSceneObject =>
          session.ids.includes(object.id) && isVectorPathObject(object) && object.locked !== true,
      ),
    [session],
  );
  const preview = useMemo(
    () =>
      deferredOperation === 'weld'
        ? planWeldSelection(session.project.scene, sources, 'boolean-preview')
        : combineVectorObjects(sources, deferredOperation, 'boolean-preview'),
    [session, sources, deferredOperation],
  );
  const after = useMemo(
    () =>
      preview.kind === 'ok'
        ? ['object' in preview.value ? preview.value.object : preview.value]
        : [],
    [preview],
  );
  return { sources, preview, after };
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
