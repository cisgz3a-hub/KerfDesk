import {
  buildCameraTransforms,
  cameraProfileReadiness,
  DEFAULT_RTSP_CAMERA_URL,
  effectiveCameraSource,
  type CameraProfile,
  type CameraProfileAlignment,
  type CameraSource,
} from '../../core/camera';
import {
  profileSupportsCapability,
  type DeviceProfile,
  type ProfileCapability,
} from '../../core/devices';
import { Button } from '../kit';
import { usePlatform } from '../app/platform-context';
import { useStore } from '../state';
import { Row, numInputStyle, unitStyle } from './device-settings-shared';
import { BrowserCameraPreview } from './MachineSetupCameraPreview';
import { mutedStyle, sectionHeadingStyle, sectionStyle, stackStyle } from './MachineSetupStyles';

export function CameraPanel(): JSX.Element {
  const device = useStore((s) => s.project.device);
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  const replaceDeviceProfile = useStore((s) => s.replaceDeviceProfile);
  const platform = usePlatform();
  const camera = device.cameraProfile;
  const updateCamera = (patch: Partial<CameraProfile>) => {
    const nextCamera = { ...(camera ?? defaultCameraProfile()), ...patch };
    updateDeviceProfile({
      cameraProfile: nextCamera,
      capabilities: setCameraCapability(device, true),
    });
  };

  if (camera === undefined) {
    return (
      <div style={stackStyle}>
        <section style={sectionStyle}>
          <h3 style={sectionHeadingStyle}>Camera</h3>
          <p style={mutedStyle}>
            Add a camera profile before alignment. This only changes the local machine profile; it
            does not move the laser or write firmware.
          </p>
          <Button variant="primary" onClick={() => updateCamera(defaultCameraProfile())}>
            Add camera
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div style={stackStyle}>
      <section style={sectionStyle}>
        <h3 style={sectionHeadingStyle}>Camera</h3>
        <CameraStatus camera={camera} />
        <CameraFields
          camera={camera}
          updateCamera={updateCamera}
          clearCamera={() => {
            const { cameraProfile: _cameraProfile, ...withoutCamera } = device;
            replaceDeviceProfile({
              ...withoutCamera,
              capabilities: setCameraCapability(device, false),
            });
          }}
        />
      </section>
      <section style={sectionStyle}>
        <h3 style={sectionHeadingStyle}>Alignment</h3>
        <p style={mutedStyle}>
          V1 uses four image-to-machine calibration points. Use bed corners for a first test, then
          replace these with measured points later.
        </p>
        <Button onClick={() => updateCamera({ alignment: bedCornerAlignment(camera, device) })}>
          Use bed corners
        </Button>
        <AlignmentRows camera={camera} updateCamera={updateCamera} />
      </section>
      <BrowserCameraPreview
        camera={camera}
        cameraBridge={platform.cameraBridge}
        updateCamera={updateCamera}
      />
    </div>
  );
}

function CameraFields(props: {
  readonly camera: CameraProfile;
  readonly updateCamera: (patch: Partial<CameraProfile>) => void;
  readonly clearCamera: () => void;
}): JSX.Element {
  const { camera, updateCamera, clearCamera } = props;
  return (
    <div style={fieldStackStyle}>
      <Row label="Enabled">
        <label style={inlineLabelStyle}>
          <input
            type="checkbox"
            checked={camera.enabled}
            onChange={(e) => updateCamera({ enabled: e.currentTarget.checked })}
            aria-label="Enable camera"
            title="Enable or disable the saved camera overlay profile."
          />
          <span>Use camera overlay</span>
        </label>
      </Row>
      <Row label="Name">
        <input
          value={camera.name}
          onChange={(e) => updateCamera({ name: e.currentTarget.value })}
          aria-label="Camera name"
          title="Name shown for this camera profile."
          style={wideInputStyle}
        />
      </Row>
      <CameraSourceRows camera={camera} updateCamera={updateCamera} />
      <CameraResolutionRow camera={camera} updateCamera={updateCamera} />
      <Row label="Overlay">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={camera.transparency}
          onChange={(e) => updateCamera({ transparency: Number(e.currentTarget.value) })}
          aria-label="Camera overlay transparency"
          title="Set how strongly the camera image appears over the workspace."
        />
        <span style={unitStyle}>{Math.round(camera.transparency * 100)}%</span>
      </Row>
      <Row label="Profile">
        <Button onClick={clearCamera}>Remove camera</Button>
      </Row>
    </div>
  );
}

function CameraSourceRows(props: {
  readonly camera: CameraProfile;
  readonly updateCamera: (patch: Partial<CameraProfile>) => void;
}): JSX.Element {
  const { camera, updateCamera } = props;
  return (
    <>
      <Row label="Source">
        <select
          aria-label="Camera source"
          title="Choose browser camera for webcams or RTSP for network camera streams."
          value={cameraSourceValue(camera)}
          onChange={(e) => updateCamera({ source: nextCameraSource(e.currentTarget.value) })}
        >
          <option value="browser">Browser camera</option>
          <option value="rtsp">RTSP / network camera</option>
        </select>
      </Row>
      {effectiveCameraSource(camera).kind === 'rtsp' ? (
        <Row label="RTSP URL">
          <input
            value={rtspCameraUrl(camera)}
            onChange={(e) => updateCamera({ source: { kind: 'rtsp', url: e.currentTarget.value } })}
            aria-label="RTSP camera URL"
            title="RTSP stream URL for cameras that do not appear as browser webcams."
            style={wideInputStyle}
          />
        </Row>
      ) : (
        <Row label="Device ID">
          <input
            value={camera.deviceId}
            onChange={(e) => updateCamera({ deviceId: e.currentTarget.value })}
            aria-label="Camera device ID"
            title="Browser camera device id saved after selecting or starting preview."
            style={wideInputStyle}
          />
        </Row>
      )}
    </>
  );
}

function CameraResolutionRow(props: {
  readonly camera: CameraProfile;
  readonly updateCamera: (patch: Partial<CameraProfile>) => void;
}): JSX.Element {
  const { camera, updateCamera } = props;
  return (
    <Row label="Resolution">
      <input
        type="number"
        min={1}
        step={1}
        value={camera.resolution?.width ?? ''}
        onChange={(e) => updateResolution(camera, updateCamera, 'width', e.currentTarget.value)}
        aria-label="Camera resolution width"
        title="Camera preview width in pixels."
        style={numInputStyle}
      />
      <span style={unitStyle}>x</span>
      <input
        type="number"
        min={1}
        step={1}
        value={camera.resolution?.height ?? ''}
        onChange={(e) => updateResolution(camera, updateCamera, 'height', e.currentTarget.value)}
        aria-label="Camera resolution height"
        title="Camera preview height in pixels."
        style={numInputStyle}
      />
      <span style={unitStyle}>px</span>
    </Row>
  );
}

function AlignmentRows(props: {
  readonly camera: CameraProfile;
  readonly updateCamera: (patch: Partial<CameraProfile>) => void;
}): JSX.Element {
  const points = props.camera.alignment?.points ?? [];
  if (points.length === 0) {
    return <p style={mutedStyle}>No alignment points yet.</p>;
  }
  return (
    <div style={alignmentGridStyle}>
      <strong>Point</strong>
      <strong>Image px</strong>
      <strong>Machine mm</strong>
      {points.map((point, index) => (
        <AlignmentRow
          key={index}
          index={index}
          point={point}
          camera={props.camera}
          updateCamera={props.updateCamera}
        />
      ))}
    </div>
  );
}

function AlignmentRow(props: {
  readonly index: number;
  readonly point: CameraProfileAlignment['points'][number];
  readonly camera: CameraProfile;
  readonly updateCamera: (patch: Partial<CameraProfile>) => void;
}): JSX.Element {
  const updateNumber = (side: 'image' | 'machine', axis: 'x' | 'y', rawValue: string): void => {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    const points = [...(props.camera.alignment?.points ?? [])];
    points[props.index] = {
      ...props.point,
      [side]: { ...props.point[side], [axis]: value },
    };
    props.updateCamera({
      alignment: { ...props.camera.alignment, points, alignedAt: new Date().toISOString() },
    });
  };
  return (
    <>
      <span>{props.index + 1}</span>
      <span style={inlineInputsStyle}>
        <input
          type="number"
          value={props.point.image.x}
          onChange={(e) => updateNumber('image', 'x', e.currentTarget.value)}
          aria-label={`Point ${props.index + 1} image X`}
          title={`Image X coordinate for alignment point ${props.index + 1}.`}
          style={smallInputStyle}
        />
        <input
          type="number"
          value={props.point.image.y}
          onChange={(e) => updateNumber('image', 'y', e.currentTarget.value)}
          aria-label={`Point ${props.index + 1} image Y`}
          title={`Image Y coordinate for alignment point ${props.index + 1}.`}
          style={smallInputStyle}
        />
      </span>
      <span style={inlineInputsStyle}>
        <input
          type="number"
          value={props.point.machine.x}
          onChange={(e) => updateNumber('machine', 'x', e.currentTarget.value)}
          aria-label={`Point ${props.index + 1} machine X`}
          title={`Machine X coordinate for alignment point ${props.index + 1}.`}
          style={smallInputStyle}
        />
        <input
          type="number"
          value={props.point.machine.y}
          onChange={(e) => updateNumber('machine', 'y', e.currentTarget.value)}
          aria-label={`Point ${props.index + 1} machine Y`}
          title={`Machine Y coordinate for alignment point ${props.index + 1}.`}
          style={smallInputStyle}
        />
      </span>
    </>
  );
}

function CameraStatus({ camera }: { readonly camera: CameraProfile }): JSX.Element {
  const readiness = cameraProfileReadiness(camera);
  const transform = buildCameraTransforms(camera.alignment);
  const message =
    readiness.kind === 'ready'
      ? 'Camera alignment ready'
      : readiness.kind === 'disabled'
        ? 'Camera configured but disabled'
        : readiness.reason;
  return (
    <div style={statusStyle} role="status">
      <strong>{message}</strong>
      {transform.kind === 'ok' && <span> Image-to-machine transform solved.</span>}
    </div>
  );
}

function defaultCameraProfile(): CameraProfile {
  return {
    id: 'workspace-camera',
    name: 'Workspace camera',
    deviceId: '',
    enabled: false,
    source: { kind: 'browser' },
    resolution: { width: 1280, height: 720 },
    transparency: 0.25,
  };
}

function cameraSourceValue(camera: CameraProfile): CameraSource['kind'] {
  return effectiveCameraSource(camera).kind;
}

function nextCameraSource(value: string): CameraSource {
  return value === 'rtsp' ? { kind: 'rtsp', url: DEFAULT_RTSP_CAMERA_URL } : { kind: 'browser' };
}

function rtspCameraUrl(camera: CameraProfile): string {
  const source = effectiveCameraSource(camera);
  return source.kind === 'rtsp' ? source.url : DEFAULT_RTSP_CAMERA_URL;
}

function bedCornerAlignment(camera: CameraProfile, device: DeviceProfile): CameraProfileAlignment {
  const resolution = camera.resolution ?? { width: 1280, height: 720 };
  return {
    alignedAt: new Date().toISOString(),
    points: [
      { image: { x: 0, y: 0 }, machine: { x: 0, y: 0 } },
      { image: { x: resolution.width, y: 0 }, machine: { x: device.bedWidth, y: 0 } },
      {
        image: { x: resolution.width, y: resolution.height },
        machine: { x: device.bedWidth, y: device.bedHeight },
      },
      { image: { x: 0, y: resolution.height }, machine: { x: 0, y: device.bedHeight } },
    ],
  };
}

function updateResolution(
  camera: CameraProfile,
  updateCamera: (patch: Partial<CameraProfile>) => void,
  key: 'width' | 'height',
  rawValue: string,
): void {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) return;
  const previous = camera.resolution ?? { width: 1280, height: 720 };
  updateCamera({ resolution: { ...previous, [key]: Math.round(value) } });
}

function setCameraCapability(
  device: DeviceProfile,
  enabled: boolean,
): ReadonlyArray<ProfileCapability> {
  const current = device.capabilities ?? [];
  const hasCamera = profileSupportsCapability(device, 'camera');
  if (enabled) return hasCamera ? current : [...current, 'camera'];
  return current.filter((capability) => capability !== 'camera');
}

const fieldStackStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const inlineLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 6,
  alignItems: 'center',
};
const inlineInputsStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 4,
  alignItems: 'center',
};
const wideInputStyle: React.CSSProperties = { width: 'min(100%, 260px)' };
const smallInputStyle: React.CSSProperties = { ...numInputStyle, width: 74 };
const alignmentGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '48px minmax(0, 1fr) minmax(0, 1fr)',
  alignItems: 'center',
  gap: 6,
  marginTop: 10,
  fontSize: 12,
};
const statusStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-2)',
  borderRadius: 4,
  padding: 8,
  marginBottom: 8,
};
