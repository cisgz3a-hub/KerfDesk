// DetectionOverlay — live corner markers over the wizard's camera view. An
// SVG whose viewBox is the camera's intrinsic pixel space, absolutely covering
// the same box as the <video>: with preserveAspectRatio "meet" it letterboxes
// exactly like the video's object-fit: contain, so intrinsic-pixel corners
// land on the displayed board without any manual rect math.

import type { Vec2 } from '../../../core/scene';

export function DetectionOverlay(props: {
  readonly corners: ReadonlyArray<Vec2>;
  readonly frameWidth: number;
  readonly frameHeight: number;
}): JSX.Element | null {
  if (props.frameWidth <= 0 || props.frameHeight <= 0) return null;
  // Marker size scales with the frame so it stays visually constant on screen.
  const radius = Math.max(2, props.frameWidth / 240);
  return (
    <svg
      viewBox={`0 0 ${props.frameWidth} ${props.frameHeight}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      style={overlayStyle}
    >
      {props.corners.map((corner, index) => (
        <circle
          // Corner order is stable for a held board; index keys are safe here.
          key={index}
          cx={corner.x}
          cy={corner.y}
          r={radius}
          fill="none"
          stroke="var(--lf-accent)"
          strokeWidth={radius / 2}
        />
      ))}
    </svg>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
};
