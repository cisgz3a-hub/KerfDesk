import { useState, useEffect } from 'react';
import {
  photoCellAt,
  registeredCellPolygon,
  validRegistration,
  type MaterialExperiment,
} from '../../core/material-library/material-experiment';
import type { Vec2 } from '../../core/scene';
import { Button } from '../kit';

export function ExperimentPhotoView(props: {
  readonly experiment: MaterialExperiment;
  readonly onChange: (value: MaterialExperiment) => void;
}): JSX.Element | null {
  const [points, setPoints] = useState<ReadonlyArray<Vec2> | null>(null);
  const photo = props.experiment.photo;
  useEffect(() => setPoints(null), [photo?.dataUrl]);
  if (photo === undefined) return null;
  const onClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
    if (points === null) {
      const cell = photoCellAt(props.experiment, point);
      if (cell !== null) props.onChange({ ...props.experiment, selectedCellId: cell.id });
      return;
    }
    const next = [...points, point];
    if (next.length === 4 && validRegistration(next)) {
      const registration = next as [Vec2, Vec2, Vec2, Vec2];
      props.onChange({ ...props.experiment, photo: { ...photo, registration } });
      setPoints(null);
    } else setPoints(next.length < 4 ? next : []);
  };
  return (
    <section aria-label="Experiment result photograph">
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <Button onClick={() => setPoints([])}>Align photo to cells</Button>
        <Button
          onClick={() => {
            const { photo: _photo, ...withoutPhoto } = props.experiment;
            props.onChange(withoutPhoto);
            setPoints(null);
          }}
        >
          Remove photo
        </Button>
        {points !== null ? <Button onClick={() => setPoints(null)}>Cancel alignment</Button> : null}
      </div>
      <p>
        {points === null
          ? photo.registration === undefined
            ? 'Align the four outside corners of the cell area to enable cell picking. Labels and runways are outside this area.'
            : 'Click an outlined cell to inspect its captured settings. Alignment is manual; verify the overlay.'
          : `Click corner ${points.length + 1} of 4: first row/first column, first row/last column, last row/last column, last row/first column. Invalid or crossed corners restart alignment.`}
      </p>
      <svg
        viewBox={`0 0 ${photo.width} ${photo.height}`}
        style={{
          width: '100%',
          display: 'block',
          cursor: 'crosshair',
          aspectRatio: `${photo.width} / ${photo.height}`,
        }}
        role="img"
        aria-label="Result photograph with test cell overlay"
        onClick={onClick}
      >
        <image href={photo.dataUrl} width={photo.width} height={photo.height} />
        <ExperimentPhotoOverlays experiment={props.experiment} points={points} />
      </svg>
    </section>
  );
}

function ExperimentPhotoOverlays(props: {
  readonly experiment: MaterialExperiment;
  readonly points: ReadonlyArray<Vec2> | null;
}): JSX.Element | null {
  const photo = props.experiment.photo;
  if (photo === undefined) return null;
  return (
    <>
      {props.experiment.cells.map((cell) => {
        const polygon = registeredCellPolygon(props.experiment, cell);
        return polygon === null ? null : (
          <polygon
            key={cell.id}
            points={polygon
              .map((point) => `${point.x * photo.width},${point.y * photo.height}`)
              .join(' ')}
            fill={
              cell.id === props.experiment.selectedCellId ? 'var(--lf-accent-wash)' : 'transparent'
            }
            stroke={
              cell.id === props.experiment.selectedCellId ? 'var(--lf-warning)' : 'var(--lf-info)'
            }
            strokeWidth={2}
          />
        );
      })}
      {(props.points ?? photo.registration ?? []).map((point, index) => (
        <g key={index}>
          <circle
            cx={point.x * photo.width}
            cy={point.y * photo.height}
            r={6}
            fill="var(--lf-warning)"
          />
          <text
            x={point.x * photo.width + 9}
            y={point.y * photo.height}
            fill="var(--lf-text)"
            stroke="var(--lf-bg-1)"
            paintOrder="stroke"
            fontSize={20}
          >
            {index + 1}
          </text>
        </g>
      ))}
    </>
  );
}
