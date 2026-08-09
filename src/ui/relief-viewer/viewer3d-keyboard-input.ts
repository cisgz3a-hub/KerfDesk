import {
  viewer3DCameraControlForKey,
  type Viewer3DCameraControl,
} from './viewer3d-keyboard-controls';

/** Installs focused-canvas camera keys and returns their exact cleanup. */
export function installViewer3DKeyboardInput(
  canvas: HTMLCanvasElement,
  onControl: (control: Viewer3DCameraControl) => void,
): () => void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    const control = viewer3DCameraControlForKey(event);
    if (control === null) return;
    event.preventDefault();
    onControl(control);
  };
  canvas.addEventListener('keydown', handleKeyDown);
  return () => canvas.removeEventListener('keydown', handleKeyDown);
}
