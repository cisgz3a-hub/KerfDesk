import { useStore } from './store';
import { currentFrameSpatialSignature } from '../laser/frame-spatial-identity';
import { usePrintCutSessionStore } from './print-cut-session-store';
import { useExperimentalLaserFeatures } from './experimental-laser-features';

/** Frame proof is temporarily absent during owned light travel. Remember the
 * first spatial edit across every wait, even when Undo restores its signature. */
export function positioningLightEditGuard(watchesArtwork: boolean) {
  const initial = useStore.getState();
  const signature = watchesArtwork ? currentFrameSpatialSignature(initial) : null;
  let changed = false;
  const observe = (): void => {
    if (changed) return;
    const current = useStore.getState();
    if (
      current.projectDocumentEpoch !== initial.projectDocumentEpoch ||
      currentFrameSpatialSignature(current) !== signature
    )
      changed = true;
  };
  const disposers = watchesArtwork
    ? [
        useStore.subscribe(observe),
        usePrintCutSessionStore.subscribe(observe),
        useExperimentalLaserFeatures.subscribe(observe),
      ]
    : [];
  return {
    dispose: (): void => {
      for (const unsubscribe of disposers) unsubscribe();
    },
    assertUnchanged: (): void => {
      if (changed) throw new Error('Artwork or placement changed during positioning.');
    },
  };
}
