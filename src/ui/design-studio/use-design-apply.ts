// use-design-apply — the Apply handler (ADR-272, Phase N DS-5, flow F-DS8).
//
// Keeps the orchestration out of the button: mint one id per entity (pure core
// may not generate identity), hand the sketch to the project store as a single
// undo entry, then clear the Studio's dirty flag.
//
// Apply LEAVES THE STUDIO OPEN, matching Image Studio: applying is not the same
// as finishing, and an operator commonly applies, checks the main canvas, then
// keeps drawing. "Apply & Close" is the variant that also stashes and closes.

import { useCallback } from 'react';
import { useStore } from '../state';
import { survivingObjectIds } from '../state/design-apply-record';
import { sessionSketch } from './design-session';
import { useDesignStudioStore } from './design-studio-store';

// 'refused': the project could not hold the drawing (ADR-307 amendment 1).
type ApplyOutcome = 'applied' | 'nothing' | 'refused';

export type DesignApplyHandlers = {
  // True when there is output geometry that has changed since the last Apply.
  readonly canApply: boolean;
  readonly apply: () => void;
  readonly applyAndClose: () => void;
};

export function useDesignApply(): DesignApplyHandlers {
  const session = useDesignStudioStore((state) => state.session);
  const markApplied = useDesignStudioStore((state) => state.markApplied);
  const closeStudio = useDesignStudioStore((state) => state.closeStudio);
  const applyDesignSketch = useStore((state) => state.applyDesignSketch);
  const scene = useStore((state) => state.project.scene);

  const apply = useCallback((): ApplyOutcome => {
    const current = useDesignStudioStore.getState().session;
    if (current === null) return 'nothing';
    const sketch = sessionSketch(current);
    if (
      sketch.entities.length === 0 &&
      survivingObjectIds(useStore.getState().project.scene, current.applied).size === 0 &&
      useStore.getState().project.designStudioDocument === undefined
    )
      return 'nothing';
    // Handing back what the last Apply created is what makes a second Apply an
    // EDIT of that artwork rather than a duplicate of it.
    const record = applyDesignSketch(
      sketch,
      sketch.entities.map(() => crypto.randomUUID()),
      current.applied,
      { activeLayerId: current.activeLayerId, surface3d: current.surface3d },
    );
    // Refused, with a notice: the drawing stays unapplied, and Apply stays on
    // for when there is room.
    if (record === 'refused') return 'refused';
    markApplied(record);
    return 'applied';
  }, [applyDesignSketch, markApplied]);

  const applyAndClose = useCallback((): void => {
    // A refused Apply keeps the Studio open on the drawing it could not add.
    if (apply() === 'refused') return;
    closeStudio();
  }, [apply, closeStudio]);

  return {
    canApply:
      session !== null &&
      session.dirtySinceApply &&
      (sessionSketch(session).entities.length > 0 ||
        survivingObjectIds(scene, session.applied).size > 0 ||
        session.applied !== null),
    apply: () => {
      apply();
    },
    applyAndClose,
  };
}
