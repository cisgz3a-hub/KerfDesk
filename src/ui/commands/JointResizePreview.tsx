import { useMemo, useState } from 'react';
import type { JointCandidate, JointResizeObject } from '../../core/geometry/joint-resize';
import type { Vec2 } from '../../core/scene';
import { applyTransform } from '../../core/scene/transform';

export function JointResizePreview(props: {
  readonly before: ReadonlyArray<JointResizeObject>;
  readonly after: ReadonlyArray<JointResizeObject>;
  readonly candidates: ReadonlyArray<JointCandidate>;
  readonly selected: ReadonlyArray<string>;
}): JSX.Element | null {
  const [originalVisible, setOriginalVisible] = useState(true);
  const [resultVisible, setResultVisible] = useState(true);
  const before = useMemo(() => geometry(props.before), [props.before]);
  const after = useMemo(() => geometry(props.after), [props.after]);
  const points = [...before.points, ...after.points];
  if (points.length === 0) return null;
  const minX = Math.min(...points.map((p) => p.x)),
    minY = Math.min(...points.map((p) => p.y));
  const width = Math.max(1, Math.max(...points.map((p) => p.x)) - minX);
  const height = Math.max(1, Math.max(...points.map((p) => p.y)) - minY);
  const margin = Math.max(width, height) * 0.08;
  const labelSize = Math.max(width, height) / 45;
  return (
    <div>
      <svg
        role="img"
        aria-label="Numbered joint openings original and proposed geometry"
        width="100%"
        height={220}
        viewBox={`${minX - margin} ${minY - margin} ${width + margin * 2} ${height + margin * 2}`}
        style={{
          background: 'var(--lf-bg-canvas)',
          border: '1px solid var(--lf-border)',
          borderRadius: 4,
        }}
      >
        {originalVisible && (
          <path
            d={before.d}
            fill="none"
            stroke="var(--lf-text-faint)"
            strokeWidth={2}
            strokeDasharray="5 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {resultVisible && (
          <path
            d={after.d}
            fill="none"
            stroke="var(--lf-accent)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <JointCandidateMarkers
          candidates={props.candidates}
          selected={props.selected}
          labelSize={labelSize}
        />
      </svg>
      <JointPreviewToggles
        originalVisible={originalVisible}
        resultVisible={resultVisible}
        setOriginalVisible={setOriginalVisible}
        setResultVisible={setResultVisible}
      />
    </div>
  );
}
function geometry(objects: ReadonlyArray<JointResizeObject>): {
  readonly d: string;
  readonly points: ReadonlyArray<Vec2>;
} {
  const points: Vec2[] = [];
  const commands: string[] = [];
  for (const object of objects)
    for (const path of object.paths) {
      const lines =
        path.curves === undefined
          ? path.polylines
          : path.curves.map((curve) => ({
              closed: curve.closed,
              points: [curve.start, ...curve.segments.map((segment) => segment.to)],
            }));
      for (const line of lines) {
        line.points.forEach((point, index) => {
          const transformed = applyTransform(point, object.transform);
          points.push(transformed);
          commands.push(`${index === 0 ? 'M' : 'L'}${transformed.x} ${transformed.y}`);
        });
        if (line.closed) commands.push('Z');
      }
    }
  return { d: commands.join(''), points };
}

function JointCandidateMarkers(props: {
  readonly candidates: ReadonlyArray<JointCandidate>;
  readonly selected: ReadonlyArray<string>;
  readonly labelSize: number;
}): JSX.Element {
  const { labelSize } = props;
  return (
    <>
      {' '}
      {props.candidates.map((candidate, index) => (
        <g
          key={candidate.id}
          aria-label={`Feature ${index + 1}`}
          transform={`translate(${candidate.centre.x},${candidate.centre.y})`}
        >
          <circle
            r={labelSize}
            fill="var(--lf-bg-canvas)"
            stroke={
              props.selected.includes(candidate.id) ? 'var(--lf-accent)' : 'var(--lf-text-faint)'
            }
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={labelSize * 1.5}
            fill="var(--lf-text)"
          >
            {index + 1}
          </text>
        </g>
      ))}
    </>
  );
}

function JointPreviewToggles(props: {
  readonly originalVisible: boolean;
  readonly resultVisible: boolean;
  readonly setOriginalVisible: (value: boolean) => void;
  readonly setResultVisible: (value: boolean) => void;
}): JSX.Element {
  const { originalVisible, resultVisible, setOriginalVisible, setResultVisible } = props;
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <label>
        <input
          type="checkbox"
          checked={originalVisible}
          title="Show original outlines as dashed lines."
          onChange={(event) => setOriginalVisible(event.currentTarget.checked)}
        />{' '}
        Original (dashed)
      </label>
      <label>
        <input
          type="checkbox"
          checked={resultVisible}
          title="Show proposed outlines as solid lines."
          onChange={(event) => setResultVisible(event.currentTarget.checked)}
        />{' '}
        Result (solid)
      </label>
    </div>
  );
}
