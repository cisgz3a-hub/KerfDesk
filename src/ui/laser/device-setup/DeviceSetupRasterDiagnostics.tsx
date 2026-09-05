import { useMemo, useState } from 'react';
import type { DeviceProfile } from '../../../core/devices';
import { useStore } from '../../state';
import { RasterDiagnosticsPanel } from '../MachineSetupRasterDiagnostics';

/** The setup draft owns every calibration write; opening diagnostics does not read hardware. */
export function DeviceSetupRasterDiagnostics(props: {
  readonly device: DeviceProfile;
  readonly onChange: (patch: Partial<DeviceProfile>) => void;
}): JSX.Element {
  const [isActivated, setIsActivated] = useState(false);
  const project = useStore((state) => state.project);
  const draftProject = useMemo(
    () => ({ ...project, device: props.device }),
    [project, props.device],
  );
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open) setIsActivated(true);
      }}
    >
      <summary style={{ cursor: 'pointer' }}>Raster Diagnostics and assisted conversion</summary>
      {isActivated ? (
        <>
          <p role="note">
            Apply and verification actions update this setup draft only. Save machine setup commits
            the draft; Cancel discards it. Save before generating a verification coupon.
          </p>
          <RasterDiagnosticsPanel draft={{ project: draftProject, onChange: props.onChange }} />
        </>
      ) : null}
    </details>
  );
}
