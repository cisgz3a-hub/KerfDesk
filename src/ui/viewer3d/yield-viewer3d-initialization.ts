/** Lets input and paint run between independent WebGL scene setup phases. */
export function yieldViewer3dInitialization(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
