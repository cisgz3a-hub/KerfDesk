// RtspSourceControls — connect an operator-entered RTSP camera through the
// local bridge (ADR-116). Folded in from the removed Machine Setup camera
// tab: the URL is probed by the bridge, previewed as MJPEG, and captured via
// the single-frame proxy. The last URL persists locally (machine-local
// operator input, like the preferred USB device).

import { useState } from 'react';
import { usePlatform } from '../../app';
import { loadRtspCameraUrl, saveRtspCameraUrl } from '../../state/camera-preference-storage';
import { type CameraSourceState, useCameraStore } from '../../state/camera-store';
import { CameraSourceView } from '../CameraSourceView';
import type { ActiveCameraSource } from '../frame-source';
import { noteStyle, rowStyle, sectionStyle } from './panel-styles';

type RtspControlState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'live';
      readonly source: Extract<ActiveCameraSource, { readonly kind: 'machine-rtsp' }>;
    };

export function RtspSourceControls(): JSX.Element {
  const bridge = usePlatform().cameraBridge;
  const startRtspSource = useCameraStore((s) => s.startRtspSource);
  const sourceState = useCameraStore((s) => s.sourceState);
  const reportSourceFailure = useCameraStore((s) => s.reportSourceFailure);
  const stopSource = useCameraStore((s) => s.stopSource);
  const [url, setUrl] = useState(() => loadRtspCameraUrl() ?? '');

  const control = rtspControlState(sourceState);
  const rtspSource = control.kind === 'live' ? control.source : null;
  const rtspStarting = control.kind === 'starting';
  const rtspError = control.kind === 'error' ? control.message : null;
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
          disabled={rtspSource === null && (url.trim() === '' || rtspStarting)}
          onClick={rtspSource === null ? connect : stopSource}
          title={
            rtspSource === null
              ? 'Probe the RTSP camera through the local bridge and use it as the camera source.'
              : 'Stop the RTSP camera preview.'
          }
        >
          {rtspButtonLabel(control)}
        </button>
      </div>
      {rtspError === null ? null : (
        <p role="status" style={errorStyle}>
          {rtspError}
        </p>
      )}
      {rtspSource !== null ? (
        <CameraSourceView source={rtspSource} onFailure={() => reportSourceFailure(rtspSource)} />
      ) : null}
    </details>
  );
}

function rtspControlState(state: CameraSourceState): RtspControlState {
  if (state.kind === 'live' && state.source.kind === 'machine-rtsp') {
    return { kind: 'live', source: state.source };
  }
  if (state.kind === 'starting' && state.sourceKind === 'machine-rtsp') return { kind: 'starting' };
  if (state.kind === 'error' && state.sourceKind === 'machine-rtsp') {
    return { kind: 'error', message: state.message };
  }
  return { kind: 'idle' };
}

function rtspButtonLabel(control: RtspControlState): string {
  switch (control.kind) {
    case 'live':
      return 'Stop';
    case 'starting':
      return 'Connecting…';
    case 'error':
      return 'Reconnect';
    case 'idle':
      return 'Connect';
  }
}

const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12 };
const urlStyle: React.CSSProperties = { flex: 1, minWidth: 0 };
const errorStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-danger)' };
