import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_RTSP_CAMERA_URL,
  effectiveCameraSource,
  type CameraProfile,
} from '../../core/camera';
import type { CameraBridgeAdapter, CameraBridgeProbeResult } from '../../platform/types';
import { Button } from '../kit';
import { mutedStyle, sectionHeadingStyle, sectionStyle } from './MachineSetupStyles';

export function BrowserCameraPreview(props: {
  readonly camera: CameraProfile;
  readonly cameraBridge: CameraBridgeAdapter | undefined;
  readonly updateCamera: (patch: Partial<CameraProfile>) => void;
}): JSX.Element {
  const source = effectiveCameraSource(props.camera);
  if (source.kind === 'rtsp') {
    return <RtspCameraPreview cameraBridge={props.cameraBridge} url={source.url} />;
  }

  return <BrowserMediaCameraPreview camera={props.camera} updateCamera={props.updateCamera} />;
}

function BrowserMediaCameraPreview(props: {
  readonly camera: CameraProfile;
  readonly updateCamera: (patch: Partial<CameraProfile>) => void;
}): JSX.Element {
  const { devices, listCameras, notice, startPreview, stopPreview, videoRef } =
    useBrowserCameraPreview(props);
  const selectableDevices = devices.filter((device) => device.deviceId.trim() !== '');

  return (
    <section style={sectionStyle}>
      <h3 style={sectionHeadingStyle}>Browser Preview</h3>
      <p style={mutedStyle}>This tests the browser camera feed only; alignment is saved above.</p>
      <div style={buttonRowStyle}>
        <Button onClick={() => void listCameras()}>List cameras</Button>
        <Button onClick={() => void startPreview()}>Start preview</Button>
        <Button onClick={stopPreview}>Stop preview</Button>
        <Button
          onClick={() =>
            props.updateCamera({ source: { kind: 'rtsp', url: DEFAULT_RTSP_CAMERA_URL } })
          }
        >
          Use built-in RTSP camera
        </Button>
      </div>
      {devices.length > 0 && (
        <CameraDeviceSelect
          camera={props.camera}
          devices={devices}
          selectableDevices={selectableDevices}
          updateCamera={props.updateCamera}
        />
      )}
      {notice !== null && <p style={noticeStyle}>{notice}</p>}
      <video ref={videoRef} autoPlay muted playsInline style={videoStyle} />
    </section>
  );
}

function RtspCameraPreview(props: {
  readonly cameraBridge: CameraBridgeAdapter | undefined;
  readonly url: string;
}): JSX.Element {
  const [probe, setProbe] = useState<CameraBridgeProbeResult | null>(null);
  const [busy, setBusy] = useState(false);

  const probeCamera = async (): Promise<void> => {
    setBusy(true);
    try {
      const result =
        props.cameraBridge?.isSupported() === true
          ? await props.cameraBridge.probeRtspCamera({ url: props.url })
          : {
              kind: 'unavailable' as const,
              reason:
                'The desktop camera bridge is not available in this runtime. Open LaserForge Desktop to preview RTSP cameras.',
            };
      setProbe(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={sectionStyle}>
      <h3 style={sectionHeadingStyle}>RTSP Bridge Preview</h3>
      <p style={mutedStyle}>
        RTSP cameras are not browser cameras. LaserForge previews this stream through the local
        desktop bridge: {props.url}
      </p>
      <div style={buttonRowStyle}>
        <Button onClick={() => void probeCamera()} disabled={busy}>
          {busy ? 'Probing...' : 'Probe RTSP camera'}
        </Button>
      </div>
      {probe !== null && <RtspProbeResult result={probe} />}
    </section>
  );
}

function RtspProbeResult({ result }: { readonly result: CameraBridgeProbeResult }): JSX.Element {
  if (result.kind === 'ok') {
    return (
      <div style={rtspResultStyle} role="status">
        <strong>RTSP reachable</strong>
        {result.codec !== undefined && <span> Codec: {result.codec}.</span>}
        {!result.ffmpegAvailable && (
          <p style={noticeStyle}>FFmpeg preview bridge is not available.</p>
        )}
        {result.previewUrl !== undefined && result.ffmpegAvailable && (
          <img src={result.previewUrl} alt="RTSP camera preview" style={videoStyle} />
        )}
      </div>
    );
  }
  return (
    <p style={noticeStyle} role="status">
      {result.reason}
    </p>
  );
}

function useBrowserCameraPreview(props: {
  readonly camera: CameraProfile;
  readonly updateCamera: (patch: Partial<CameraProfile>) => void;
}): {
  readonly devices: ReadonlyArray<MediaDeviceInfo>;
  readonly listCameras: () => Promise<void>;
  readonly notice: string | null;
  readonly startPreview: () => Promise<void>;
  readonly stopPreview: () => void;
  readonly videoRef: React.RefObject<HTMLVideoElement>;
} {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<ReadonlyArray<MediaDeviceInfo>>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => () => stopStream(streamRef), []);
  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices?.addEventListener === undefined) return undefined;
    const handleDeviceChange = () => void refreshCameras({ requestPermission: false });
    mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  });

  const listCameras = async () => {
    await refreshCameras({ requestPermission: true });
  };

  const startPreview = async () => {
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices?.getUserMedia === undefined) {
      setNotice('Browser camera API is not available.');
      return;
    }
    stopStream(streamRef);
    try {
      const stream = await mediaDevices.getUserMedia({
        video: videoConstraints(props.camera),
      });
      streamRef.current = stream;
      if (videoRef.current !== null) videoRef.current.srcObject = stream;
      applyActiveDeviceId(stream, props.updateCamera);
      await refreshCameras({ requestPermission: false });
    } catch (err) {
      setNotice(cameraPermissionNotice(err));
    }
  };
  const stopPreview = () => {
    stopStream(streamRef);
    if (videoRef.current !== null) videoRef.current.srcObject = null;
  };

  const refreshCameras = async (options: { readonly requestPermission: boolean }) => {
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices?.enumerateDevices === undefined) {
      setNotice('Browser camera API is not available.');
      return;
    }

    let nextDevices = await enumerateVideoDevices(mediaDevices);
    let permissionNotice: string | null = null;
    if (
      options.requestPermission &&
      shouldUnlockCameraList(nextDevices) &&
      mediaDevices.getUserMedia !== undefined
    ) {
      try {
        const permissionStream = await mediaDevices.getUserMedia({ video: true, audio: false });
        stopTracks(permissionStream);
        nextDevices = await enumerateVideoDevices(mediaDevices);
      } catch (err) {
        permissionNotice = cameraPermissionNotice(err);
      }
    }

    setDevices(nextDevices);
    setNotice(permissionNotice ?? cameraListNotice(nextDevices));
  };

  return { devices, listCameras, notice, startPreview, stopPreview, videoRef };
}

function CameraDeviceSelect(props: {
  readonly camera: CameraProfile;
  readonly devices: ReadonlyArray<MediaDeviceInfo>;
  readonly selectableDevices: ReadonlyArray<MediaDeviceInfo>;
  readonly updateCamera: (patch: Partial<CameraProfile>) => void;
}): JSX.Element {
  return (
    <select
      value={props.camera.deviceId}
      title="Choose the browser camera used for workspace preview."
      onChange={(event) => {
        const selected = props.devices.find(
          (device) => device.deviceId === event.currentTarget.value,
        );
        props.updateCamera({
          deviceId: event.currentTarget.value,
          ...(selected?.label ? { name: selected.label } : {}),
        });
      }}
      aria-label="Browser camera device"
    >
      <option value="">Default camera</option>
      {props.selectableDevices.map((device, index) => (
        <option key={device.deviceId} value={device.deviceId}>
          {device.label || `Camera ${index + 1}`}
        </option>
      ))}
    </select>
  );
}

async function enumerateVideoDevices(
  mediaDevices: Pick<MediaDevices, 'enumerateDevices'>,
): Promise<ReadonlyArray<MediaDeviceInfo>> {
  return (await mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
}

function shouldUnlockCameraList(devices: ReadonlyArray<MediaDeviceInfo>): boolean {
  return (
    devices.length <= 1 ||
    devices.some((device) => device.deviceId.trim() === '') ||
    devices.every((device) => device.label.trim() === '')
  );
}

function cameraListNotice(devices: ReadonlyArray<MediaDeviceInfo>): string | null {
  if (devices.length === 0) return 'No browser cameras found.';
  if (devices.length === 1) {
    return 'Only one browser camera is visible. If the machine camera is built into the controller over one USB cable, use RTSP mode instead of the browser camera picker.';
  }
  if (devices.some((device) => device.label.trim() === '')) {
    return 'Camera names are hidden until browser camera permission is allowed.';
  }
  return null;
}

function cameraPermissionNotice(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return `Camera permission was not granted (${detail}). The browser may only show the default camera until permission is allowed.`;
}

function applyActiveDeviceId(
  stream: MediaStream,
  updateCamera: (patch: Partial<CameraProfile>) => void,
): void {
  const track = stream.getVideoTracks?.()[0];
  const deviceId = track?.getSettings?.().deviceId;
  if (typeof deviceId === 'string' && deviceId.trim() !== '') updateCamera({ deviceId });
}

function videoConstraints(camera: CameraProfile): MediaTrackConstraints {
  return {
    ...(camera.deviceId.trim() !== '' ? { deviceId: { exact: camera.deviceId } } : {}),
    ...(camera.resolution !== undefined
      ? {
          width: { ideal: camera.resolution.width },
          height: { ideal: camera.resolution.height },
        }
      : {}),
  };
}

function stopStream(streamRef: React.MutableRefObject<MediaStream | null>): void {
  if (streamRef.current !== null) stopTracks(streamRef.current);
  streamRef.current = null;
}

function stopTracks(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

const buttonRowStyle: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' };
const noticeStyle: React.CSSProperties = { color: 'var(--lf-danger-fg)', margin: '8px 0 0' };
const rtspResultStyle: React.CSSProperties = {
  border: '1px solid var(--lf-border)',
  background: 'var(--lf-bg-2)',
  borderRadius: 4,
  padding: 8,
  marginTop: 8,
};
const videoStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  maxHeight: 260,
  marginTop: 8,
  background: 'var(--lf-text)',
  borderRadius: 4,
};
