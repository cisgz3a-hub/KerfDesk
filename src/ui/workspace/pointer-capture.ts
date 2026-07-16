export function capturePointer(canvas: HTMLCanvasElement | null, pointerId: number): void {
  canvas?.setPointerCapture?.(pointerId);
}

export function releasePointer(canvas: HTMLCanvasElement | null, pointerId: number): void {
  if (canvas?.hasPointerCapture?.(pointerId) === true) canvas.releasePointerCapture(pointerId);
}
