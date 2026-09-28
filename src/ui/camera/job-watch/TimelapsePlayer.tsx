// TimelapsePlayer — plays a timelapse's frames in the Camera panel (ADR-490)
// at the video's frame rate, with a slider to step through them. Only the
// frame on screen has an object URL, released as soon as it is replaced.

import { useEffect, useState } from 'react';
import { TIMELAPSE_VIDEO_FPS } from '../../../core/camera/job-watch/timelapse-frames';
import { rowStyle } from '../panel/panel-styles';

export function TimelapsePlayer(props: { readonly frames: ReadonlyArray<Blob> }): JSX.Element {
  const { frames } = props;
  const last = Math.max(0, frames.length - 1);
  const [index, setIndex] = useState(last);
  const [playing, setPlaying] = useState(false);
  const shown = Math.min(index, last);
  const url = useFrameUrl(frames[shown]);

  useEffect(() => {
    if (!playing) return;
    if (shown >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex(shown + 1), 1000 / TIMELAPSE_VIDEO_FPS);
    return () => clearTimeout(timer);
  }, [playing, shown, last]);

  const togglePlay = (): void => {
    if (!playing && shown >= last) setIndex(0);
    setPlaying(!playing);
  };

  return (
    <div style={playerStyle}>
      {url === null ? null : (
        <img src={url} alt={`Timelapse frame ${shown + 1}`} style={imageStyle} />
      )}
      <div style={{ ...rowStyle, alignItems: 'center', flexWrap: 'nowrap' }}>
        <button
          type="button"
          className="lf-btn"
          onClick={togglePlay}
          title={playing ? 'Stop playing the timelapse.' : 'Play the timelapse frames in order.'}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          aria-label="Timelapse frame"
          title="Drag to show any frame of the timelapse."
          min={0}
          max={last}
          value={shown}
          onChange={(event) => {
            setPlaying(false);
            setIndex(Number(event.target.value));
          }}
          style={sliderStyle}
        />
      </div>
    </div>
  );
}

function useFrameUrl(frame: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (frame === undefined || typeof URL.createObjectURL !== 'function') {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(frame);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [frame]);
  return url;
}

const playerStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const imageStyle: React.CSSProperties = {
  width: '100%',
  maxHeight: 240,
  objectFit: 'contain',
  background: 'var(--lf-bg-1)',
  borderRadius: 4,
};
const sliderStyle: React.CSSProperties = { flex: 1, minWidth: 0 };
