// SnapshotControls — save a still of the active camera source as a PNG, and
// toggle the panel between compact and large (monitoring) sizes (F-CAM9).

import { usePlatform } from '../../app';
import { useCameraStore } from '../../state/camera-store';
import { useToastStore } from '../../state/toast-store';
import { saveCameraSnapshot } from '../snapshot';
import { rowStyle } from './panel-styles';

export function SnapshotControls(props: {
  readonly wide: boolean;
  readonly onToggleWide: () => void;
}): JSX.Element {
  const platform = usePlatform();
  const sourceState = useCameraStore((s) => s.sourceState);
  const pushToast = useToastStore((s) => s.pushToast);

  const save = async (): Promise<void> => {
    if (sourceState.kind !== 'live') return;
    const result = await saveCameraSnapshot(sourceState.source, platform);
    if (result === 'saved') pushToast('Snapshot saved.', 'success');
    if (result === 'capture-failed') pushToast('Could not capture a camera frame.', 'error');
    if (result === 'encode-failed') pushToast('Could not encode the snapshot PNG.', 'error');
    // 'cancelled' is the operator changing their mind — no toast.
  };

  return (
    <div style={rowStyle}>
      <button
        type="button"
        className="lf-btn"
        disabled={sourceState.kind !== 'live'}
        onClick={() => void save()}
        title="Save the current camera frame as a PNG file."
      >
        Save snapshot…
      </button>
      <button
        type="button"
        className="lf-btn"
        aria-pressed={props.wide}
        onClick={props.onToggleWide}
        title="Toggle a larger camera panel for monitoring a running job."
      >
        {props.wide ? 'Compact view' : 'Larger view'}
      </button>
    </div>
  );
}
