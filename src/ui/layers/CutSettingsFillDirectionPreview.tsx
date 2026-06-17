const PREVIEW_WIDTH = 132;
const PREVIEW_HEIGHT = 72;
const PREVIEW_CENTER_X = PREVIEW_WIDTH / 2;
const PREVIEW_CENTER_Y = PREVIEW_HEIGHT / 2;
const PREVIEW_HALF_LENGTH = 44;
const PREVIEW_LINE_SPACING = 11;
const PREVIEW_PRIMARY_LINE_COUNT = 7;
const PREVIEW_CROSS_LINE_COUNT = 5;
const PREVIEW_PRIMARY_COLOR = 'var(--lf-accent)';
const PREVIEW_CROSS_COLOR = 'var(--lf-warning)';
const PREVIEW_TRAVEL_COLOR = 'var(--lf-muted)';
const ARROW_LENGTH = 4.5;
const ARROW_SPREAD = 0.45;

export function CutSettingsFillDirectionPreview(props: {
  readonly angleDeg: number;
  readonly crossHatch: boolean;
}): JSX.Element {
  const lineCount = props.crossHatch ? PREVIEW_CROSS_LINE_COUNT : PREVIEW_PRIMARY_LINE_COUNT;
  return (
    <svg
      aria-label="Fill scan direction preview"
      role="img"
      viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
      width={PREVIEW_WIDTH}
      height={PREVIEW_HEIGHT}
      style={previewStyle}
    >
      <rect x={1} y={1} width={PREVIEW_WIDTH - 2} height={PREVIEW_HEIGHT - 2} style={bedStyle} />
      {props.crossHatch ? (
        <ScanPass
          angleDeg={props.angleDeg + 90}
          color={PREVIEW_CROSS_COLOR}
          lineCount={lineCount}
          pass="cross-hatch"
        />
      ) : null}
      <ScanPass
        angleDeg={props.angleDeg}
        color={PREVIEW_PRIMARY_COLOR}
        lineCount={lineCount}
        pass="primary"
      />
    </svg>
  );
}

function ScanPass(props: {
  readonly angleDeg: number;
  readonly color: string;
  readonly lineCount: number;
  readonly pass: 'primary' | 'cross-hatch';
}): JSX.Element {
  const lines = scanLines(props.angleDeg, props.lineCount);
  return (
    <g data-fill-pass={props.pass}>
      {lines.map((line, index) => (
        <g key={`${props.pass}-${index}`}>
          {index > 0 ? <TravelLine previous={lines[index - 1]} current={line} /> : null}
          <BurnLine line={line} color={props.color} />
        </g>
      ))}
    </g>
  );
}

type PreviewLine = {
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
  readonly direction: 1 | -1;
  readonly cos: number;
  readonly sin: number;
  readonly perpCos: number;
  readonly perpSin: number;
};

function scanLines(angleDeg: number, count: number): ReadonlyArray<PreviewLine> {
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const perpCos = -sin;
  const perpSin = cos;
  return Array.from({ length: count }, (_, index) => {
    const offset = (index - Math.floor(count / 2)) * PREVIEW_LINE_SPACING;
    const x = PREVIEW_CENTER_X + offset * perpCos;
    const y = PREVIEW_CENTER_Y + offset * perpSin;
    return {
      startX: x - PREVIEW_HALF_LENGTH * cos,
      startY: y - PREVIEW_HALF_LENGTH * sin,
      endX: x + PREVIEW_HALF_LENGTH * cos,
      endY: y + PREVIEW_HALF_LENGTH * sin,
      direction: index % 2 === 0 ? 1 : -1,
      cos,
      sin,
      perpCos,
      perpSin,
    };
  });
}

function TravelLine(props: {
  readonly previous: PreviewLine | undefined;
  readonly current: PreviewLine;
}): JSX.Element | null {
  if (props.previous === undefined) return null;
  const from = directedEnd(props.previous);
  const to = directedStart(props.current);
  return <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} style={travelStyle} />;
}

function BurnLine(props: { readonly line: PreviewLine; readonly color: string }): JSX.Element {
  const end = directedEnd(props.line);
  const wingA = {
    x:
      end.x -
      props.line.direction * ARROW_LENGTH * (props.line.cos + props.line.perpCos * ARROW_SPREAD),
    y:
      end.y -
      props.line.direction * ARROW_LENGTH * (props.line.sin + props.line.perpSin * ARROW_SPREAD),
  };
  const wingB = {
    x:
      end.x -
      props.line.direction * ARROW_LENGTH * (props.line.cos - props.line.perpCos * ARROW_SPREAD),
    y:
      end.y -
      props.line.direction * ARROW_LENGTH * (props.line.sin - props.line.perpSin * ARROW_SPREAD),
  };
  return (
    <g>
      <line
        x1={props.line.startX}
        y1={props.line.startY}
        x2={props.line.endX}
        y2={props.line.endY}
        style={{ ...burnStyle, stroke: props.color }}
      />
      <path
        d={`M ${end.x} ${end.y} L ${wingA.x} ${wingA.y} M ${end.x} ${end.y} L ${wingB.x} ${wingB.y}`}
        style={{ ...burnStyle, stroke: props.color }}
      />
    </g>
  );
}

function directedStart(line: PreviewLine): { readonly x: number; readonly y: number } {
  return line.direction === 1 ? { x: line.startX, y: line.startY } : { x: line.endX, y: line.endY };
}

function directedEnd(line: PreviewLine): { readonly x: number; readonly y: number } {
  return line.direction === 1 ? { x: line.endX, y: line.endY } : { x: line.startX, y: line.startY };
}

const previewStyle: React.CSSProperties = {
  display: 'block',
  borderRadius: 6,
};

const bedStyle: React.CSSProperties = {
  fill: 'var(--lf-surface-muted)',
  stroke: 'var(--lf-border)',
};

const burnStyle: React.CSSProperties = {
  fill: 'none',
  strokeLinecap: 'round',
  strokeWidth: 1.8,
};

const travelStyle: React.CSSProperties = {
  ...burnStyle,
  stroke: PREVIEW_TRAVEL_COLOR,
  strokeDasharray: '3 3',
  strokeWidth: 1,
};
