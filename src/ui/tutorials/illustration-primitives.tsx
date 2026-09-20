/* eslint-disable no-restricted-syntax -- Fixed SVG illustration colours represent sample artwork and materials, not application chrome. */
export type SceneProps = { readonly phase: number };
export const INK = '#29414a';
export const TEAL = '#0f766e';
export const TEAL_LIGHT = '#bce4dc';
export const GOLD = '#b86b16';
export const MUTED = '#849b9f';

export function Pointer(props: { readonly x: number; readonly y: number }): JSX.Element {
  return (
    <g transform={`translate(${props.x} ${props.y})`}>
      <circle r="14" fill="#f5c26955" />
      <path d="M0 0v22l6-6 5 9 5-3-5-9h9Z" fill={INK} stroke="white" strokeWidth="1.5" />
    </g>
  );
}

export function Label(props: {
  readonly x: number;
  readonly y: number;
  readonly children: React.ReactNode;
  readonly accent?: boolean;
}): JSX.Element {
  return (
    <text
      x={props.x}
      y={props.y}
      fill={props.accent === true ? TEAL : INK}
      fontSize="13"
      fontWeight="600"
      textAnchor="middle"
    >
      {props.children}
    </text>
  );
}

export function Arrow(props: {
  readonly x: number;
  readonly y: number;
  readonly width?: number;
}): JSX.Element {
  const width = props.width ?? 55;
  return (
    <g transform={`translate(${props.x} ${props.y})`} stroke={GOLD} strokeWidth="2" fill="none">
      <path d={`M0 0h${width}m-8-6 8 6-8 6`} />
    </g>
  );
}

export function Handles(props: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}): JSX.Element {
  return (
    <g stroke={TEAL} fill="white" strokeWidth="1.5">
      <rect
        x={props.x}
        y={props.y}
        width={props.w}
        height={props.h}
        fill="none"
        strokeDasharray="5 4"
      />
      {[0, 1].flatMap((x) =>
        [0, 1].map((y) => (
          <rect
            key={`${x}${y}`}
            x={props.x + x * props.w - 4}
            y={props.y + y * props.h - 4}
            width="8"
            height="8"
          />
        )),
      )}
    </g>
  );
}

export function Card(props: {
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly title: string;
  readonly rows: readonly string[];
  readonly active?: number;
}): JSX.Element {
  const width = props.width ?? 166;
  return (
    <g transform={`translate(${props.x} ${props.y})`}>
      <rect
        width={width}
        height={40 + props.rows.length * 30}
        rx="7"
        fill="white"
        stroke="#cddbd9"
      />
      <text x="12" y="23" fontSize="12" fontWeight="700" fill={INK}>
        {props.title}
      </text>
      {props.rows.map((row, index) => (
        <g key={row} transform={`translate(8 ${34 + index * 30})`}>
          <rect
            width={width - 16}
            height="25"
            rx="4"
            fill={index === props.active ? TEAL_LIGHT : '#eef3f2'}
          />
          <text x="7" y="17" fontSize="11" fill={index === props.active ? TEAL : INK}>
            {row}
          </text>
        </g>
      ))}
    </g>
  );
}
