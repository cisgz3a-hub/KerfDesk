import { useEffect, useMemo, useRef, useState } from 'react';
import type { FixtureTemplate } from '../../../core/camera/fixtures/fixture-template';
import type { FixturePlacementPlan } from '../../../core/camera/fixtures/fixture-layout';
import type { Project } from '../../../core/scene';
import {
  fixtureContextWarnings,
  fixturePlacements,
} from '../../../core/camera/fixtures/fixture-layout';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { selectionFrame } from './selection-frame';
import { fixtureBasis } from '../../state/fixture-template-actions';
import { fixtureCameraContextNow } from './fixture-camera-context';
import { proOperationMutationSetter } from '../../licensing/pro-operation-mutation';
import { applySelectionPlacements } from '../../state/array-actions';
import { FEWER_PIECES } from '../../state/array-room';
import { commitFixtureTemplate } from './fixture-template-commit';
import { useActiveCameraModel } from '../active-camera-model';

export function useFixtureReview(template: FixtureTemplate, onClose: () => void) {
  const [owner] = useState(captureFixtureReviewOwner);
  const [included, setIncluded] = useState<ReadonlyArray<string>>(() =>
    template.slots.filter((slot) => !slot.piece.partial).map((slot) => slot.id),
  );
  const [reviewed, setReviewed] = useState(false);
  const revision = useRef(0);
  useEffect(
    () => () => {
      revision.current += 1;
    },
    [],
  );
  const { project, epoch, primary, additional, source, height, areas, model, warnings } =
    useFixtureReviewContext(owner, template);
  useEffect(() => {
    revision.current += 1;
    setReviewed(false);
  }, [source, height, areas, model]);
  const plan = useMemo(
    () => (owner.design === null ? null : fixturePlacements(template, owner.design, included)),
    [template, owner.design, included],
  );
  const current =
    project === owner.project &&
    epoch === owner.epoch &&
    primary === owner.primary &&
    additional === owner.additional;
  const isCurrent = (): boolean => {
    const state = useStore.getState();
    return (
      state.project === owner.project &&
      state.projectDocumentEpoch === owner.epoch &&
      state.selectedObjectId === owner.primary &&
      state.additionalSelectedIds === owner.additional
    );
  };
  const close = (): void => {
    revision.current += 1;
    onClose();
  };
  const choose = (id: string, checked: boolean): void => {
    revision.current += 1;
    setReviewed(false);
    setIncluded((ids) => (checked ? [...ids, id] : ids.filter((item) => item !== id)));
  };
  const confirm = (value: boolean): void => {
    revision.current += 1;
    setReviewed(value);
  };
  const apply = (): void => {
    if (!isCurrent() || !reviewed || plan?.kind !== 'ok') return;
    commitReviewedFixture(plan.value, owner.project, revision, isCurrent, close);
  };
  const remove = (): void => {
    if (isCurrent())
      commitFixtureTemplate(
        owner.project,
        owner.epoch,
        { deleteId: template.id },
        close,
        isCurrent,
      );
  };
  return {
    owner,
    included,
    reviewed,
    current,
    warnings,
    plan,
    close,
    choose,
    confirm,
    apply,
    remove,
  };
}
export type FixtureReview = ReturnType<typeof useFixtureReview>;

function captureFixtureReviewOwner() {
  const state = useStore.getState();
  return {
    project: state.project,
    epoch: state.projectDocumentEpoch,
    primary: state.selectedObjectId,
    additional: state.additionalSelectedIds,
    design: selectionFrame(state.project, state.selectedObjectId, state.additionalSelectedIds),
  };
}
function useFixtureReviewContext(
  owner: ReturnType<typeof captureFixtureReviewOwner>,
  template: FixtureTemplate,
) {
  const project = useStore((state) => state.project),
    epoch = useStore((state) => state.projectDocumentEpoch);
  const primary = useStore((state) => state.selectedObjectId),
    additional = useStore((state) => state.additionalSelectedIds);
  const source = useCameraStore((state) => state.sourceState),
    height = useCameraStore((state) => state.surfaceHeightMm),
    areas = useCameraStore((state) => state.heightAreas);
  const model = useActiveCameraModel();
  const warnings = fixtureContextWarnings(
    template,
    fixtureBasis(project),
    fixtureCameraContextNow(),
    owner.design,
  );
  return { project, epoch, primary, additional, source, height, areas, model, warnings };
}

function commitReviewedFixture(
  plan: FixturePlacementPlan,
  project: Project,
  revision: React.MutableRefObject<number>,
  isCurrent: () => boolean,
  close: () => void,
): void {
  const submitted = ++revision.current;
  const reviewedCameraKey = JSON.stringify(fixtureCameraContextNow());
  const mutate = proOperationMutationSetter(useStore.setState, useStore.getState);
  mutate(
    (state) =>
      applySelectionPlacements(state, () => plan.placements, undefined, {
        instances: plan.placements.length,
        ask: FEWER_PIECES,
      }),
    () => {
      if (useStore.getState().project !== project) close();
    },
    () =>
      revision.current === submitted &&
      isCurrent() &&
      JSON.stringify(fixtureCameraContextNow()) === reviewedCameraKey,
  );
}
