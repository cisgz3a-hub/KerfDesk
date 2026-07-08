// CameraDiagnostics — the self-check row for the hardware pass (ADR-116):
// bridge liveness/capabilities, the active source, and an on-demand capture
// test proving pixels are actually readable (the property every camera
// feature depends on). Every failure renders as an actionable one-liner.

import { useEffect, useState } from 'react';
import { usePlatform } from '../../app';
import type { CameraBridgeHealth } from '../../../platform/types';
import { useCameraStore } from '../../state/camera-store';
import { captureSourceFrame } from '../frame-source';
import { errStyle, noteStyle, rowStyle } from './panel-styles';

const BRIDGE_MISSING: CameraBridgeHealth = {
  kind: 'unavailable',
  reason: 'No camera bridge on this platform.',
};

export function CameraDiagnostics(): JSX.Element {
  const bridge = usePlatform().cameraBridge;
  const sourceState = useCameraStore((s) => s.sourceState);
  const [health, setHealth] = useState<CameraBridgeHealth | null>(null);
  const [captureResult, setCaptureResult] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = bridge === undefined ? BRIDGE_MISSING : await bridge.health();
      if (alive) setHealth(result);
    })();
    return () => {
      alive = false;
    };
  }, [bridge]);

  const testCapture = async (): Promise<void> => {
    if (sourceState.kind !== 'live') return;
    setCaptureResult('Capturing…');
    const frame = await captureSourceFrame(sourceState.source);
    setCaptureResult(
      frame === null
        ? 'Capture FAILED — frame not readable (camera off, bridge down, or CORS-blocked).'
        : `Captured ${frame.width}×${frame.height} — pixels readable.`,
    );
  };

  return (
    <details>
      <summary
        style={summaryStyle}
        title="Self-check: bridge liveness, ffmpeg, active source, and a pixel-readability capture test."
      >
        Diagnostics
      </summary>
      <div style={bodyStyle}>
        <BridgeLine health={health} />
        <p style={noteStyle}>
          Source:{' '}
          {sourceState.kind === 'live' ? sourceLabel(sourceState.source.kind) : sourceState.kind}
        </p>
        <div style={rowStyle}>
          <button
            type="button"
            className="lf-btn"
            disabled={sourceState.kind !== 'live'}
            onClick={() => void testCapture()}
            title="Grab one frame from the active source and verify its pixels are readable."
          >
            Test capture
          </button>
        </div>
        {captureResult !== null ? (
          <p style={captureResult.includes('FAILED') ? errStyle : noteStyle}>{captureResult}</p>
        ) : null}
      </div>
    </details>
  );
}

function BridgeLine(props: { readonly health: CameraBridgeHealth | null }): JSX.Element {
  const { health } = props;
  if (health === null) return <p style={noteStyle}>Bridge: checking…</p>;
  if (health.kind === 'unavailable') return <p style={errStyle}>Bridge: {health.reason}</p>;
  return (
    <p style={noteStyle}>
      Bridge: running · frame proxy {health.frameProxy ? 'yes' : 'NO (update LaserForge Desktop)'} ·
      ffmpeg {health.ffmpegAvailable ? 'yes' : 'no (RTSP cameras disabled)'}
    </p>
  );
}

function sourceLabel(kind: 'usb' | 'machine-jpeg' | 'machine-rtsp'): string {
  if (kind === 'usb') return 'USB camera (live)';
  return kind === 'machine-jpeg' ? 'machine camera (live)' : 'RTSP camera (live)';
}

const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 12 };
const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  paddingTop: 6,
  fontSize: 12,
};
