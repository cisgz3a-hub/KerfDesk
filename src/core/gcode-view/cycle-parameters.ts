import type { RenderModal } from './render-model-words';

type ResolvedCycleParameters = {
  readonly rPlane: number;
  readonly depth: number;
  readonly dwellSeconds: number | null;
};

/** Resolve sticky cycle words to the absolute millimeter geometry the viewer uses. */
export function resolveCycleParameters(
  modal: RenderModal,
  words: ReadonlyMap<string, number>,
  peckDepth: number | null,
): ResolvedCycleParameters | null {
  const scaled = (letter: string): number | null => {
    const raw = words.get(letter);
    return raw === undefined ? null : raw * modal.unitScale;
  };
  modal.cycleR = scaled('R') ?? modal.cycleR;
  modal.cycleZ = scaled('Z') ?? modal.cycleZ;
  modal.cycleQ = peckDepth === null ? modal.cycleQ : peckDepth * modal.unitScale;
  if (modal.cycleR === null || modal.cycleZ === null) return null;
  // In G91, R is relative to the series' initial plane; Z is relative to R.
  // Keep the programmed lengths sticky so a repeated hole does not drift.
  const rPlane = modal.absolute ? modal.cycleR : modal.cycleInitialZ + modal.cycleR;
  return {
    rPlane,
    depth: modal.absolute ? modal.cycleZ : rPlane + modal.cycleZ,
    dwellSeconds: modal.cycle === 82 ? modal.cycleP : null,
  };
}
