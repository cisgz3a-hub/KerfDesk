// CameraEstimatedArea — where the camera picture is estimated rather than
// measured, and may be off by more than placing artwork by eye allows
// (ADR-441 Amendment 9, rolling audit v13 Y1-P2-1). Drawn over the camera
// overlay whenever it shows, not only with the accuracy map: the bed cells
// past the target whose estimated error is over the good limit are tinted,
// with a line saying how far off the picture may be there.

import type { CSSProperties } from 'react';
import {
  extrapolationEstimate,
  GOOD_EXTRAPOLATED_MM,
} from '../../../core/camera/model/extrapolation-estimate';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import type { ViewTransform } from '../../workspace/view-transform';

export function CameraEstimatedArea(props: {
  readonly model: CameraModelRecord;
  readonly view: ViewTransform;
  readonly width: number;
  readonly height: number;
}): JSX.Element | null {
  const { model, view } = props;
  if (model.mount?.kind === 'head') return null;
  const estimate = extrapolationEstimate(model);
  if (estimate === null || estimate.worstMm <= GOOD_EXTRAPOLATED_MM) return null;
  const { stepMm, columns, rows, errorMm } = estimate.grid;
  const cell = stepMm * view.scale;
  const cells: JSX.Element[] = [];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      const mm = errorMm[j * columns + i] ?? Number.NaN;
      if (!(mm > GOOD_EXTRAPOLATED_MM)) continue;
      cells.push(
        <rect
          key={`${i},${j}`}
          x={view.offsetX + (i * stepMm - stepMm / 2) * view.scale}
          y={view.offsetY + (j * stepMm - stepMm / 2) * view.scale}
          width={cell}
          height={cell}
        />,
      );
    }
  }
  return (
    <>
      <svg
        width={props.width}
        height={props.height}
        viewBox={`0 0 ${props.width} ${props.height}`}
        style={svgStyle}
        data-testid="camera-estimated-area"
      >
        <g fill="var(--lf-warning)" fillOpacity={0.18} stroke="none">
          {cells}
        </g>
      </svg>
      <div style={legendStyle} data-testid="camera-estimated-area-legend">
        Tinted: the camera picture is estimated here, not measured, and may be up to about{' '}
        {Math.round(estimate.worstMm * 10) / 10} mm off. A calibration target on a larger sheet
        measures more of the bed.
      </div>
    </>
  );
}

const svgStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'visible',
  pointerEvents: 'none',
};
const legendStyle: CSSProperties = {
  position: 'absolute',
  right: 8,
  bottom: 8,
  maxWidth: 320,
  padding: '4px 8px',
  borderRadius: 4,
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-text)',
  fontSize: 'var(--lf-text-xs)',
  lineHeight: 1.35,
  opacity: 0.92,
  pointerEvents: 'none',
};
