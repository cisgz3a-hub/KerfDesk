import { useState } from 'react';
import { useStore } from '../../state';
import { usePieceScanStore } from './piece-scan-store';
import { selectionFrame } from './selection-frame';
import { fixtureCameraContextNow } from './fixture-camera-context';
import { captureFixtureTemplate } from '../../state/fixture-template-actions';
import { commitFixtureTemplate } from './fixture-template-commit';

export function useSaveFixtureReview(onClose: () => void) {
  const [owner] = useState(() => {
    const state = useStore.getState();
    return {
      project: state.project,
      epoch: state.projectDocumentEpoch,
      primary: state.selectedObjectId,
      additional: state.additionalSelectedIds,
      scan: usePieceScanStore.getState().scan,
      design: selectionFrame(state.project, state.selectedObjectId, state.additionalSelectedIds),
      camera: fixtureCameraContextNow(),
      id: crypto.randomUUID(),
      now: new Date().toISOString(),
    };
  });
  const [name, setName] = useState('');
  const project = useStore((state) => state.project);
  const epoch = useStore((state) => state.projectDocumentEpoch);
  const primary = useStore((state) => state.selectedObjectId);
  const additional = useStore((state) => state.additionalSelectedIds);
  const scan = usePieceScanStore((state) => state.scan);
  const isCurrent = (): boolean => {
    const state = useStore.getState();
    return (
      state.project === owner.project &&
      state.projectDocumentEpoch === owner.epoch &&
      state.selectedObjectId === owner.primary &&
      state.additionalSelectedIds === owner.additional &&
      usePieceScanStore.getState().scan === owner.scan
    );
  };
  const current =
    project === owner.project &&
    epoch === owner.epoch &&
    primary === owner.primary &&
    additional === owner.additional &&
    scan === owner.scan;
  const result =
    owner.scan === null
      ? null
      : captureFixtureTemplate({
          project: owner.project,
          scan: owner.scan,
          design: owner.design,
          name,
          id: owner.id,
          now: owner.now,
          ...(owner.camera === undefined ? {} : { camera: owner.camera }),
        });
  const save = (): void => {
    if (result?.kind === 'ok' && isCurrent())
      commitFixtureTemplate(owner.project, owner.epoch, result.value, onClose, isCurrent);
  };
  return { owner, name, setName, current, result, save };
}
