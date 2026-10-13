import type { StartInteractionInput } from './start-point-interaction';

/** Numeric snapshots avoid treating fresh but equal view objects as changes. */
export function pointerView(input: StartInteractionInput): ReadonlyArray<number> {
  const canvas = input.canvas.current;
  if (canvas === null) return [];
  const rect = canvas.getBoundingClientRect();
  return [
    input.view.zoomFactor,
    input.view.panX,
    input.view.panY,
    canvas.width,
    canvas.height,
    rect.left,
    rect.top,
    rect.width,
    rect.height,
  ];
}

export function samePointerView(
  active: { readonly pointerView: ReadonlyArray<number> },
  input: StartInteractionInput,
): boolean {
  const current = pointerView(input);
  return (
    current.length === active.pointerView.length &&
    current.every((value, index) => value === active.pointerView[index])
  );
}
