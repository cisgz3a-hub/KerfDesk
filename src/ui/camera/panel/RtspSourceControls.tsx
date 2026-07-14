// RtspSourceControls — connect an operator-entered RTSP camera through the
// local bridge (ADR-116). Folded in from the removed Machine Setup camera
// tab: the URL is probed by the bridge, previewed as MJPEG, and captured via
// the single-frame proxy. The last URL persists locally (machine-local
// operator input, like the preferred USB device).

import { useState } from 'react';
import { usePlatform } from '../../app';
import { loadRtspCameraUrl, saveRtspCameraUrl } from '../../state/camera-preference-storage';
import { useCameraStore } from '../../state/camera-store';
import { CameraSourceView } from '../CameraSourceView';
import { noteStyle, rowStyle, sectionStyle } from './panel-styles';

export function RtspSourceControls(): JSX.Element {
  const bridge = usePlatform().cameraBridge;
  const startRtspSource = useCameraStore((s) => s.startRtspSource);
  const sourceState = useCameraStore((s) => s.sourceState);
  const [url, setUrl] = useState(() => loadRtspCameraUrl() ?? '');

  const rtspActive = sourceState.kind === 'live' && sourceState.source.kind === 'machine-rtsp';
  const connect = (): void => {
    saveRtspCameraUrl(url);
    void startRtspSource(bridge, url);
  };

  return (
    <details style={sectionStyle}>
      <summary
        style={summaryStyle}
        title="Connect a machine camera that streams RTSP through the local bridge."
      >
        RTSP camera…
      </summary>
      <p style={noteStyle}>
        For machines whose camera streams RTSP (e.g. rtsp://192.168.10.1:8554/). Credentials are
        used for this connection but are never saved.
      </p>
      <div style={rowStyle}>
        <input
          type="text"
          aria-label="RTSP camera URL"
          title="The camera's rtsp:// URL on your machine's network."
          placeholder="rtsp://…"
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          style={urlStyle}
        />
        <button
          type="button"
          className="lf-btn"
          disabled={url.trim() === '' || sourceState.kind === 'starting' || rtspActive}
          onClick={connect}
          title="Probe the RTSP camera through the local bridge and use it as the camera source."
        >
          {rtspActive ? 'Connected' : 'Connect'}
        </button>
      </div>
      {rtspActive && sourceState.kind === 'live' ? (
        <CameraSourceView source={sourceState.source} />
      ) : null}
    </details>
  );
}

const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12 };
const urlStyle: React.CSSProperties = { flex: 1, minWidth: 0 };
