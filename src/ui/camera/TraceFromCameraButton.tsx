// TraceFromCameraButton — capture the whole bed, flatten it top-down at the
// material height and each height area's own height, and open the normal
// Trace dialog (ADR-110, ADR-440). Split from OverlayControls: tracing is a
// capture pipeline, not an overlay preference.

import { useTraceFromCamera } from './use-trace-from-camera';

export function TraceFromCameraButton(): JSX.Element {
  const { available, trace } = useTraceFromCamera();
  return (
    <button
      type="button"
      className="lf-btn"
      disabled={!available}
      onClick={() => void trace(null)}
      title="Capture the bed, flatten it top-down at the material height (and each height area's own height), and trace it. Vectors land at the object's true position."
    >
      Trace from camera
    </button>
  );
}
