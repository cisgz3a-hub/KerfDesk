import type { MouseEvent as ReactMouseEvent } from 'react';
import { type Project, type Vec2 } from '../../core/scene';
import { hitTestCandidates } from '../../core/scene/hit-test-candidates';

export function nextSelectionHit(
  candidates: ReadonlyArray<string>,
  selectedObjectId: string | null,
): string | null {
  const currentIndex = selectedObjectId === null ? -1 : candidates.indexOf(selectedObjectId);
  if (candidates.length === 0) return null;
  return candidates[(currentIndex + 1) % candidates.length] ?? null;
}

export function handleAltSelectionCycle(args: {
  readonly e: ReactMouseEvent<HTMLCanvasElement>;
  readonly project: Project;
  readonly point: Vec2;
  readonly selectedObjectId: string | null;
  readonly onShiftClick: (id: string) => void;
  readonly onPlainClick: (id: string | null) => void;
}): boolean {
  if (args.e.button !== 0 || !args.e.altKey) return false;
  const hitId = nextSelectionHit(
    hitTestCandidates(args.project.scene, args.point),
    args.selectedObjectId,
  );
  if (hitId === null) return true;
  if (args.e.shiftKey) args.onShiftClick(hitId);
  else args.onPlainClick(hitId);
  return true;
}
