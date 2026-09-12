import type { SnapGuide } from '../workspace/snapping';

type SnapGuideState = { readonly snapGuides: ReadonlyArray<SnapGuide> };

/** Preserve store identity when pointer movement leaves the visible guides unchanged. */
export function snapGuideStateUpdate(
  state: SnapGuideState,
  next: ReadonlyArray<SnapGuide>,
): SnapGuideState {
  return sameSnapGuides(state.snapGuides, next) ? state : { snapGuides: next };
}

function sameSnapGuides(
  previous: ReadonlyArray<SnapGuide>,
  next: ReadonlyArray<SnapGuide>,
): boolean {
  return (
    previous === next ||
    (previous.length === next.length &&
      previous.every((guide, index) => {
        const other = next[index];
        return (
          other !== undefined &&
          guide.axis === other.axis &&
          Object.is(guide.positionMm, other.positionMm) &&
          Object.is(guide.fromMm, other.fromMm) &&
          Object.is(guide.toMm, other.toMm)
        );
      }))
  );
}
