import { generatePhotoTestCard, type PhotoTestCardOptions } from '../../core/job/photo-test-card';
import { confirmDiscardAsync } from '../app/confirm-discard';
import { usePlatform } from '../app/platform-context';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import {
  photoTestProcessing,
  readLastPhotoTestCard,
  writeLastPhotoTestCard,
  type PhotoTestSeed,
} from './photo-test-card-draft';
import { closePhotoTestCard, type PhotoTestCardSession } from './photo-test-card-store';
import { usePhotoTestLibrary, type PhotoTestResult } from './photo-test-library';
import { PhotoTestCardDialog } from './PhotoTestCardDialog';

/** ADR-711: one open Photo Test Card: generates the card, or saves the picked square. */
export default function PhotoTestCardSessionDialog({
  session,
}: {
  readonly session: PhotoTestCardSession;
}): JSX.Element {
  const maxFeedMmPerMin = useStore((state) => state.project.device.maxFeed);
  const platform = usePlatform();
  const generate = async (options: PhotoTestCardOptions, seed: PhotoTestSeed): Promise<void> => {
    if (!(await confirmDiscardAsync(platform, 'create a photo test card'))) return;
    const card = generatePhotoTestCard(options);
    useStore.getState().replaceSceneWithGeneratedScene(card.scene);
    writeLastPhotoTestCard({
      sourceName: seed.sourceName,
      powers: card.powers,
      speeds: card.speeds,
      processing: photoTestProcessing(seed.settings),
    });
    closePhotoTestCard();
    useToastStore
      .getState()
      .pushToast(
        `Generated a photo test card of ${card.cells.length} squares. Burn it, then open ` +
          'Tools → Photo Test Card → Pick the best square. Undo brings your photo back.',
        'success',
      );
  };
  const save = (result: PhotoTestResult): void => {
    const stored = usePhotoTestLibrary.getState().save(result);
    closePhotoTestCard();
    useToastStore
      .getState()
      .pushToast(
        stored
          ? `Saved "${result.label}". Choose it under Power and speed in Photo engraving.`
          : `"${result.label}" is available until KerfDesk closes; this computer did not let ` +
              'it be saved.',
        stored ? 'success' : 'warning',
      );
  };
  return (
    <PhotoTestCardDialog
      // With a burned card and no photo to cut a new one from, open at Pick.
      initialStep={
        session.step ??
        (session.seed === null && readLastPhotoTestCard() !== null ? 'pick' : 'generate')
      }
      seed={session.seed}
      maxFeedMmPerMin={maxFeedMmPerMin}
      onClose={closePhotoTestCard}
      onGenerate={(options, seed) => void generate(options, seed)}
      onSave={save}
    />
  );
}
