// CameraAccuracyMap — the saved calibration's measured error drawn over the
// workspace camera overlay (ADR-441 Amendment 1). Each engraved ring sits
// where the laser put it, coloured by how far the camera model placed it, and
// a dashed outline marks the area the target covered: inside it the error is
// measured, outside it the picture is extrapolated. It follows the canvas
// view (zoom and pan) through the same transform as the overlay.

import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import type { ViewTransform } from '../../workspace/view-transform';
import {
  FAIR_RING_MM,
  GOOD_RING_MM,
  REJECTED_RING_COLOUR,
  ringErrorColour,
} from './ring-error-colour';

// A 10 mm ring is drawn a little smaller so neighbours stay apart, but never
// so small that it vanishes when zoomed out.
const DOT_RADIUS_MM = 3;
const MIN_DOT_RADIUS_PX = 2.5;

export function CameraAccuracyMap(props: {
  readonly model: CameraModelRecord;
  readonly view: ViewTransform;
  readonly width: number;
  readonly height: number;
}): JSX.Element | null {
  const { model, view } = props;
  const marks = model.accuracy.marks ?? [];
  if (marks.length === 0) return null;
  const area = model.accuracy.targetArea;
  const toX = (mm: number): number => view.offsetX + mm * view.scale;
  const toY = (mm: number): number => view.offsetY + mm * view.scale;
  const radius = Math.max(MIN_DOT_RADIUS_PX, DOT_RADIUS_MM * view.scale);
  return (
    <>
      <svg
        width={props.width}
        height={props.height}
        viewBox={`0 0 ${props.width} ${props.height}`}
        style={svgStyle}
        data-testid="camera-accuracy-map"
      >
        {area === undefined ? null : (
          <rect
            x={toX(area.x)}
            y={toY(area.y)}
            width={area.width * view.scale}
            height={area.height * view.scale}
            fill="none"
            stroke="var(--lf-text-faint)"
            strokeDasharray="6 4"
          />
        )}
        {marks.map((mark) => {
          const cx = toX(mark.x);
          const cy = toY(mark.y);
          const key = `${mark.x},${mark.y}`;
          if (mark.rejected === true) {
            return (
              <circle
                key={key}
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke={REJECTED_RING_COLOUR}
                strokeWidth={1.5}
              />
            );
          }
          const error = Math.hypot(mark.dxMm, mark.dyMm);
          return <circle key={key} cx={cx} cy={cy} r={radius} fill={ringErrorColour(error)} />;
        })}
      </svg>
      <div style={legendStyle}>
        Camera accuracy at {model.accuracy.targetHeightMm} mm: green within {GOOD_RING_MM} mm, amber
        within {FAIR_RING_MM} mm, red beyond; hollow rings were left out of the fit.
        {area === undefined ? null : ' Outside the dashed outline the picture is extrapolated.'}
      </div>
    </>
  );
}

const svgStyle: React.CSSProperties = { position: 'absolute', inset: 0, overflow: 'visible' };
const legendStyle: React.CSSProperties = {
  position: 'absolute',
  left: 8,
  bottom: 8,
  maxWidth: 360,
  padding: '4px 8px',
  borderRadius: 4,
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-text)',
  fontSize: 'var(--lf-text-xs)',
  lineHeight: 1.35,
  opacity: 0.92,
};
