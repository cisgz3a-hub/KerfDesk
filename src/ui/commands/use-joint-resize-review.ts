import { useEffect, useMemo, useRef, useState } from 'react';
import {
  analyseJointResize,
  previewJointResize,
  type JointResizeRequest,
  type JointResizeObject,
} from '../../core/geometry/joint-resize';
import { evaluateNumericEntry } from '../../core/numeric-expression';
import { useStore } from '../state';
import { selectedObjectIds } from '../state/scene-group-actions';
import {
  jointResizeSelectionMutation,
  jointResizeSessionIsCurrent,
  type JointResizeSession,
} from '../state/joint-resize-actions';
import { proOperationMutationSetter } from '../licensing/pro-operation-mutation';
import { useToastStore } from '../state/toast-store';
export type JointResizeForm = Record<keyof JointResizeRequest, string>;
const INITIAL: JointResizeForm = {
  currentWidthMm: '3',
  materialThicknessMm: '3',
  fitAllowanceMm: '0.1',
  detectionToleranceMm: '0.1',
};
export function useJointResizeReview(onClose: () => void) {
  const [session] = useState<JointResizeSession>(() => {
    const state = useStore.getState();
    return {
      project: state.project,
      documentEpoch: state.projectDocumentEpoch,
      ids: selectedObjectIds(state),
    };
  });
  const [form, setForm] = useState(INITIAL);
  const [chosen, setChosen] = useState<ReadonlyArray<string>>([]);
  const revision = useRef(0);
  useEffect(
    () => () => {
      revision.current += 1;
    },
    [],
  );
  const current = useCurrentJointOwner(session);
  const request = useMemo(() => parseRequest(form), [form]);
  const geometry = useJointPreview(session, request, chosen);
  const close = (): void => {
    revision.current += 1;
    onClose();
  };
  const change = (key: keyof JointResizeForm, value: string): void => {
    revision.current += 1;
    setChosen([]);
    setForm((previous) => ({ ...previous, [key]: value }));
  };
  const choose = (id: string, checked: boolean): void => {
    revision.current += 1;
    setChosen((ids) => (checked ? [...ids, id] : ids.filter((item) => item !== id)));
  };
  const apply = (): void => {
    if (!current || geometry.preview.kind !== 'ok') return;
    const submittedRevision = ++revision.current;
    const isCurrent = (): boolean =>
      revision.current === submittedRevision &&
      jointResizeSessionIsCurrent(useStore.getState(), session);
    const mutate = proOperationMutationSetter(useStore.setState, useStore.getState);
    mutate(
      (state) => {
        const result = jointResizeSelectionMutation(state, session, request, chosen);
        if (result.kind === 'ok') return result.value;
        useToastStore.getState().pushToast(result.error.message, 'warning');
        return {};
      },
      close,
      isCurrent,
    );
  };
  return { ...geometry, form, chosen, current, close, change, choose, apply };
}
export type JointResizeReview = ReturnType<typeof useJointResizeReview>;
function useCurrentJointOwner(session: JointResizeSession): boolean {
  const project = useStore((state) => state.project);
  const epoch = useStore((state) => state.projectDocumentEpoch);
  const primary = useStore((state) => state.selectedObjectId);
  const additional = useStore((state) => state.additionalSelectedIds);
  return jointResizeSessionIsCurrent(
    {
      ...useStore.getState(),
      project,
      projectDocumentEpoch: epoch,
      selectedObjectId: primary,
      additionalSelectedIds: additional,
    },
    session,
  );
}
function useJointPreview(
  session: JointResizeSession,
  request: JointResizeRequest,
  chosen: ReadonlyArray<string>,
) {
  const sources = useMemo(
    () => session.project.scene.objects.filter((object) => session.ids.includes(object.id)),
    [session],
  );
  const analysis = useMemo(() => analyseJointResize(sources, request), [sources, request]);
  const preview = useMemo(
    () => previewJointResize(sources, request, chosen),
    [sources, request, chosen],
  );
  const displaySources = useMemo(() => {
    const candidates = analysis.kind === 'ok' ? analysis.value.candidates : [];
    return sources.filter(
      (object): object is JointResizeObject =>
        (object.kind === 'imported-svg' || object.kind === 'traced-image') &&
        candidates.some((candidate) => candidate.objectId === object.id),
    );
  }, [sources, analysis]);
  const after = useMemo(() => {
    const updated = new Map(
      preview.kind === 'ok' ? preview.value.objects.map((object) => [object.id, object]) : [],
    );
    return displaySources.map((object) => updated.get(object.id) ?? object);
  }, [displaySources, preview]);
  return { analysis, preview, displaySources, after };
}
function parseRequest(form: JointResizeForm): JointResizeRequest {
  const value = (key: keyof JointResizeForm): number => {
    const parsed = evaluateNumericEntry(form[key], { kind: 'length' });
    return parsed.kind === 'ok' ? parsed.value : Number.NaN;
  };
  return {
    currentWidthMm: value('currentWidthMm'),
    materialThicknessMm: value('materialThicknessMm'),
    fitAllowanceMm: value('fitAllowanceMm'),
    detectionToleranceMm: value('detectionToleranceMm'),
  };
}
