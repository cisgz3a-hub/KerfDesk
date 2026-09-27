// AccuracyMapToggle — shows or hides the calibration's measured ring errors
// over the workspace camera overlay (ADR-441 Amendment 1). Offered only for a
// calibration saved with its rings.

import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';

export function AccuracyMapToggle(): JSX.Element | null {
  const marks = useStore((s) => s.project.device.cameraModel?.accuracy.marks?.length ?? 0);
  const visible = useCameraStore((s) => s.accuracyMapVisible);
  const setVisible = useCameraStore((s) => s.setAccuracyMapVisible);
  if (marks === 0) return null;
  return (
    <button
      type="button"
      className="lf-btn"
      aria-pressed={visible}
      onClick={() => setVisible(!visible)}
      title="Draw each calibration ring on the canvas, coloured by how accurately the camera placed it."
    >
      {visible ? 'Accuracy map on' : 'Accuracy map off'}
    </button>
  );
}
