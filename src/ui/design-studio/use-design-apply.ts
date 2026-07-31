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
import { outputSketchBounds, type Sketch } from '../../core/design';
import { useStore } from '../state';
import { sessionSketch } from './design-session';
import { useDesignStudioStore } from './design-studio-store';

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

  const apply = useCallback((): boolean => {
    const current = useDesignStudioStore.getState().session;
    if (current === null) return false;
    const sketch = sessionSketch(current);
    if (!hasOutputGeometry(sketch)) return false;
    applyDesignSketch(
      sketch,
      sketch.entities.map(() => crypto.randomUUID()),
    );
    markApplied();
    return true;
  }, [applyDesignSketch, markApplied]);

  const applyAndClose = useCallback((): void => {
    apply();
    closeStudio();
  }, [apply, closeStudio]);

  return {
    canApply:
      session !== null && session.dirtySinceApply && hasOutputGeometry(sessionSketch(session)),
    apply: () => {
      apply();
    },
    applyAndClose,
  };
}

// Construction-only sketches contribute nothing to output, so Apply has nothing
// to do. Measured from the output bounds rather than the entity count, so a
// sketch of guides alone reads as empty.
function hasOutputGeometry(sketch: Sketch): boolean {
  const bounds = outputSketchBounds(sketch);
  return bounds.maxX > bounds.minX || bounds.maxY > bounds.minY;
}
