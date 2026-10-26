// PictureCheckStep — the guided setup's third screen (ADR-663): a look at the
// camera picture before anything is engraved. KerfDesk measures a frame every
// few seconds (bright enough, nothing washed out, how fine the picture is) and
// lists what it cannot see for itself. Advice only: Next is always offered.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  assessPicture,
  COARSE_MM_PER_PIXEL,
  type PictureQuality,
} from '../../../core/camera/picture-quality';
import { Icon } from '../../kit/icons';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { CameraSourceView } from '../CameraSourceView';
import { captureSourceFrame, type ActiveCameraSource } from '../frame-source';
import { useCameraCalibrationStore } from './camera-calibration-store';
import { WizardNav } from './WizardNav';
import { columnStyle, errStyle, noteStyle } from './wizard-styles';

// Often enough to follow a light being switched on, light on a slow camera.
export const PICTURE_CHECK_INTERVAL_MS = 3000;

type Measured = {
  readonly quality: PictureQuality;
  readonly width: number;
  readonly height: number;
};

export function PictureCheckStep(): JSX.Element {
  const sourceState = useCameraStore((s) => s.sourceState);
  const headCamera = useCameraCalibrationStore((s) => s.settings.headCamera);
  const setStep = useCameraCalibrationStore((s) => s.setStep);
  const source = sourceState.kind === 'live' ? sourceState.source : null;
  const measured = usePictureMeasure(source);
  return (
    <div style={columnStyle}>
      <p style={leadStyle}>Check the picture</p>
      {source === null ? (
        <p style={errStyle}>No camera is running. Go back and pick one.</p>
      ) : (
        <div style={previewStyle}>
          <CameraSourceView source={source} />
        </div>
      )}
      {measured === null ? null : <PictureChecks measured={measured} />}
      <p style={noteStyle}>Also make sure that:</p>
      <ul style={tipsStyle}>
        <li>
          {headCamera
            ? 'the head can carry the camera over every part of the bed you use'
            : 'the camera sees the whole bed'}
        </li>
        <li>the camera cannot move, and a lid sits where it does when you work</li>
        <li>the picture is sharp and evenly lit</li>
      </ul>
      <WizardNav
        onBack={() => setStep({ kind: 'mount' })}
        onNext={() => setStep({ kind: 'setup', note: null })}
        nextTitle="Go on to engraving the calibration target."
      />
    </div>
  );
}

// The latest measure of the running camera's picture; null until one frame is in.
function usePictureMeasure(source: ActiveCameraSource | null): Measured | null {
  const bedWidth = useStore((s) => s.project.device.bedWidth);
  const bedHeight = useStore((s) => s.project.device.bedHeight);
  const [measured, setMeasured] = useState<Measured | null>(null);
  // Survives source/bed changes so a slow old capture cannot overlap its replacement.
  const measuring = useRef(false);
  useEffect(() => {
    setMeasured(null);
    if (source === null) return;
    let cancelled = false;
    const measure = async (): Promise<void> => {
      if (measuring.current || cancelled) return;
      measuring.current = true;
      try {
        const frame = await captureSourceFrame(source).catch(() => null);
        if (cancelled || frame === null) return;
        const quality = assessPicture(frame, { widthMm: bedWidth, heightMm: bedHeight });
        if (quality !== null) setMeasured({ quality, width: frame.width, height: frame.height });
      } finally {
        measuring.current = false;
      }
    };
    void measure();
    const timer = setInterval(() => void measure(), PICTURE_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [source, bedWidth, bedHeight]);
  return measured;
}

function PictureChecks(props: { readonly measured: Measured }): JSX.Element {
  const { quality, width, height } = props.measured;
  const mmPerPixel = quality.bestMmPerPixel;
  return (
    <ul style={checksStyle} aria-label="Picture checks">
      <CheckLine ok={quality.brightness !== 'dark'}>
        {quality.brightness === 'dark'
          ? "The picture is dark. Turn on the machine's light or a lamp."
          : 'Bright enough.'}
      </CheckLine>
      <CheckLine ok={quality.brightness !== 'washed-out'}>
        {quality.brightness === 'washed-out'
          ? 'Part of the picture is washed out. Turn the light or the lid so it does not glare.'
          : 'Nothing washed out.'}
      </CheckLine>
      {mmPerPixel === null ? null : (
        <CheckLine ok={mmPerPixel <= COARSE_MM_PER_PIXEL}>
          {width} × {height} picture: each pixel covers at least {mmPerPixel.toFixed(2)} mm of the
          bed.
          {mmPerPixel > COARSE_MM_PER_PIXEL
            ? ' A larger picture size in the camera places artwork more precisely.'
            : ''}
        </CheckLine>
      )}
    </ul>
  );
}

function CheckLine(props: { readonly ok: boolean; readonly children: React.ReactNode }) {
  return (
    <li style={{ ...checkStyle, color: props.ok ? 'var(--lf-text)' : 'var(--lf-warning-fg)' }}>
      <Icon name={props.ok ? 'check' : 'warning'} size={14} />
      <span>{props.children}</span>
    </li>
  );
}

const leadStyle: CSSProperties = { margin: 0, fontWeight: 600 };
const previewStyle: CSSProperties = { maxWidth: 480 };
const checksStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  margin: 0,
  padding: 0,
  listStyle: 'none',
};
const checkStyle: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 6 };
const tipsStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 20,
  color: 'var(--lf-text-faint)',
};
