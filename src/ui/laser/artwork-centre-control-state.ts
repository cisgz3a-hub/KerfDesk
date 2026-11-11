import { useMemo, useState } from 'react';
import { useStore } from '../state';
import { currentHierarchyFocus, useDesignHierarchyStore } from '../state/design-hierarchy-store';
import { selectedObjectIds } from '../state/scene-group-actions';
import { selectedArtworkLightTargets } from './selected-artwork-light-targets';

export function useArtworkLightChoice() {
  const scene = useStore((state) => state.project.scene);
  const primary = useStore((state) => state.selectedObjectId);
  const additional = useStore((state) => state.additionalSelectedIds);
  const documentEpoch = useStore((state) => state.projectDocumentEpoch);
  const focus = useDesignHierarchyStore(() => currentHierarchyFocus(scene, documentEpoch));
  const targets = useMemo(
    () =>
      selectedArtworkLightTargets(
        scene,
        selectedObjectIds({ selectedObjectId: primary, additionalSelectedIds: additional }),
        focus,
      ),
    [scene, primary, additional, focus],
  );
  const selectionKey = JSON.stringify(targets.map((target) => target.id));
  const [chosen, setChosen] = useState('');
  const [previousSelection, setPreviousSelection] = useState(selectionKey);
  if (selectionKey !== previousSelection) {
    setPreviousSelection(selectionKey);
    setChosen('');
  }
  const target = targets.length === 1 ? targets[0] : targets.find((entry) => entry.id === chosen);
  return { targets, target, chooseTarget: setChosen };
}

export function artworkCentreBlockMessage(options: {
  readonly fileOnly: boolean;
  readonly needsSetup: boolean;
  readonly count: number;
  readonly chosen: boolean;
  readonly rotary: boolean;
  readonly placementBlocked: string | null;
  readonly machineBlocked: string | null;
  readonly disabled: boolean;
}): string | null {
  if (options.fileOnly)
    return 'This controller runs from files or its own USB link. Position the head and switch its light at the machine.';
  if (options.needsSetup)
    return 'Configure the separate LED/crosshair commands and offset in Machine Setup.';
  if (options.count === 0) return 'Select artwork on the canvas to centre its positioning light.';
  if (!options.chosen) return 'Choose which selected artwork to centre.';
  if (options.rotary)
    return 'Artwork centre & LED needs a flat bed; a rotary canvas Y is not a bed position.';
  return (
    options.placementBlocked ??
    options.machineBlocked ??
    (options.disabled ? 'Wait for the current machine operation to finish.' : null)
  );
}
