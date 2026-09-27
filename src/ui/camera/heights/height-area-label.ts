// One name for a height area, shared by the Camera panel row and the canvas
// outline so the two can be matched at a glance.

export function heightAreaLabel(index: number, surfaceHeightMm: number): string {
  return `Area ${index + 1}: ${surfaceHeightMm} mm`;
}
