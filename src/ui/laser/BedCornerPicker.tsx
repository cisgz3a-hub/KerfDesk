// BedCornerPicker — a small top-down bed diagram whose four corners and centre
// form one radio group. Machine Setup uses it for the origin (a dot plus the
// +X/+Y arrows that origin really produces) and for the recorded homing corner
// (a home marker and no arrows: firmware decides the homing direction).
//
// The front edge is drawn at the bottom, toward the operator, as on the canvas,
// whose top is always the back of the bed (origin-transform.ts). The arrows come
// from jogAxisSignsForOrigin, which is kept in lockstep with origin-transform.

import { useId, useRef } from 'react';
import { jogAxisSignsForOrigin, type Origin } from '../../core/devices';
import './bed-corner-picker.css';

type Point = { readonly x: number; readonly y: number };

// Diagram units are CSS pixels: the SVG is drawn 1:1 so the HTML radios can sit
// exactly on its corners.
const WIDTH = 156;
const HEIGHT = 116;
const BED = { left: 14, top: 18, right: 142, bottom: 92 } as const;
const CENTER: Point = { x: (BED.left + BED.right) / 2, y: (BED.top + BED.bottom) / 2 };

// Reading order (back row, centre, front row) is also the arrow-key order.
export const BED_POSITIONS: ReadonlyArray<{
  readonly value: Origin;
  readonly label: string;
  readonly point: Point;
}> = [
  { value: 'rear-left', label: 'Rear left', point: { x: BED.left, y: BED.top } },
  { value: 'rear-right', label: 'Rear right', point: { x: BED.right, y: BED.top } },
  { value: 'center', label: 'Center', point: CENTER },
  { value: 'front-left', label: 'Front left', point: { x: BED.left, y: BED.bottom } },
  { value: 'front-right', label: 'Front right', point: { x: BED.right, y: BED.bottom } },
];

export function bedPositionLabel(origin: Origin): string {
  return BED_POSITIONS.find((position) => position.value === origin)?.label ?? origin;
}

const ARROW_GAP = 10; // from the marker to the start of each arrow
const ARROW_INSET = 7; // corner arrows run just inside the bed edge
const X_ARROW_LENGTH = 40;
const Y_ARROW_LENGTH = 26;
const CENTER_Y_ARROW_LENGTH = 22;

type AxisArrow = {
  readonly axis: 'x' | 'y';
  readonly start: Point;
  readonly end: Point;
  readonly direction: Point;
  readonly labelAt: Point;
  readonly labelAnchor: 'start' | 'end';
};

// Machine +X runs toward the operator's right when the jog X sign is 1, and
// machine +Y runs away from the operator (up in this diagram) when the jog Y
// sign is 1.
export function originAxisWords(origin: Origin): { readonly x: string; readonly y: string } {
  const signs = jogAxisSignsForOrigin(origin);
  return {
    x: signs.x === 1 ? 'to your right' : 'to your left',
    y: signs.y === 1 ? 'away from you' : 'toward you',
  };
}

function axisArrows(origin: Origin, at: Point): readonly AxisArrow[] {
  const signs = jogAxisSignsForOrigin(origin);
  const inward = { x: Math.sign(CENTER.x - at.x), y: Math.sign(CENTER.y - at.y) };
  const yLength = inward.x === 0 && inward.y === 0 ? CENTER_Y_ARROW_LENGTH : Y_ARROW_LENGTH;
  const xDirection = { x: signs.x, y: 0 };
  const yDirection = { x: 0, y: -signs.y };
  const xStart = offset(at, xDirection, ARROW_GAP, { x: 0, y: inward.y * ARROW_INSET });
  const yStart = offset(at, yDirection, ARROW_GAP, { x: inward.x * ARROW_INSET, y: 0 });
  const xEnd = offset(xStart, xDirection, X_ARROW_LENGTH);
  const yEnd = offset(yStart, yDirection, yLength);
  const ySide = inward.x === 0 ? 1 : inward.x;
  return [
    {
      axis: 'x',
      start: xStart,
      end: xEnd,
      direction: xDirection,
      labelAt: offset(xEnd, xDirection, 4),
      labelAnchor: signs.x === 1 ? 'start' : 'end',
    },
    {
      axis: 'y',
      start: yStart,
      end: yEnd,
      direction: yDirection,
      labelAt: { x: yEnd.x + ySide * 5, y: yEnd.y },
      labelAnchor: ySide === 1 ? 'start' : 'end',
    },
  ];
}

function offset(from: Point, direction: Point, distance: number, shift?: Point): Point {
  return {
    x: from.x + direction.x * distance + (shift?.x ?? 0),
    y: from.y + direction.y * distance + (shift?.y ?? 0),
  };
}

const HEAD_LENGTH = 6;
const HEAD_HALF_WIDTH = 3.5;

function AxisArrowShape({ arrow }: { readonly arrow: AxisArrow }): JSX.Element {
  const { start, end, direction: d } = arrow;
  const base = offset(end, d, -HEAD_LENGTH);
  const side = { x: -d.y * HEAD_HALF_WIDTH, y: d.x * HEAD_HALF_WIDTH };
  const head = `M${end.x} ${end.y}L${base.x + side.x} ${base.y + side.y}L${base.x - side.x} ${base.y - side.y}Z`;
  return (
    <g className="lf-bed-picker__arrow" data-axis={arrow.axis}>
      <line x1={start.x} y1={start.y} x2={base.x} y2={base.y} />
      <path d={head} />
      <text
        x={arrow.labelAt.x}
        y={arrow.labelAt.y}
        textAnchor={arrow.labelAnchor}
        dominantBaseline="central"
      >
        {arrow.axis === 'x' ? '+X' : '+Y'}
      </text>
    </g>
  );
}

function BedDrawing(props: {
  readonly marker: 'origin' | 'home';
  readonly value: Origin;
  readonly at: Point | undefined;
}): JSX.Element {
  const arrows = props.marker === 'origin' && props.at ? axisArrows(props.value, props.at) : [];
  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
      <rect
        className="lf-bed-picker__bed"
        x={BED.left}
        y={BED.top}
        width={BED.right - BED.left}
        height={BED.bottom - BED.top}
        rx={2}
      />
      <line
        className="lf-bed-picker__front"
        x1={BED.left}
        y1={BED.bottom}
        x2={BED.right}
        y2={BED.bottom}
      />
      <text
        className="lf-bed-picker__edge-label"
        x={CENTER.x}
        y={9}
        textAnchor="middle"
        dominantBaseline="central"
      >
        Back
      </text>
      <text
        className="lf-bed-picker__edge-label"
        x={CENTER.x}
        y={HEIGHT - 8}
        textAnchor="middle"
        dominantBaseline="central"
      >
        Front (operator side)
      </text>
      {arrows.map((arrow) => (
        <AxisArrowShape key={arrow.axis} arrow={arrow} />
      ))}
    </svg>
  );
}

function HomeGlyph(): JSX.Element {
  return (
    <svg className="lf-bed-picker__home" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 1.5 13 6.8V12.5H1V6.8Z" />
    </svg>
  );
}

const KEY_STEPS: Readonly<Record<string, number | 'first' | 'last'>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
  Home: 'first',
  End: 'last',
};

function steppedIndex(index: number, step: number | 'first' | 'last'): number {
  const count = BED_POSITIONS.length;
  if (step === 'first') return 0;
  if (step === 'last') return count - 1;
  return (index + step + count) % count;
}

export function BedCornerPicker(props: {
  readonly value: Origin;
  readonly onChange: (next: Origin) => void;
  readonly marker: 'origin' | 'home';
  readonly ariaLabel: string;
  readonly title: string;
}): JSX.Element {
  const captionId = useId();
  const radios = useRef<Array<HTMLButtonElement | null>>([]);
  const checkedIndex = BED_POSITIONS.findIndex((position) => position.value === props.value);
  const focusIndex = checkedIndex === -1 ? 0 : checkedIndex;
  const checked = BED_POSITIONS[checkedIndex];
  // Same contract as the <select> this replaces: onChange fires only for a new value.
  const choose = (next: Origin): void => {
    if (next !== props.value) props.onChange(next);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step = KEY_STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const nextIndex = steppedIndex(index, step);
    const next = BED_POSITIONS[nextIndex];
    if (!next) return;
    radios.current[nextIndex]?.focus();
    choose(next.value);
  };
  return (
    <span className="lf-bed-picker" data-marker={props.marker}>
      <span
        className="lf-bed-picker__diagram"
        role="radiogroup"
        aria-label={props.ariaLabel}
        aria-describedby={captionId}
        title={props.title}
        style={{ width: WIDTH, height: HEIGHT }}
      >
        <BedDrawing marker={props.marker} value={props.value} at={checked?.point} />
        {BED_POSITIONS.map((position, index) => {
          const isChecked = index === checkedIndex;
          return (
            <button
              key={position.value}
              ref={(node) => {
                radios.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={isChecked}
              aria-label={position.label}
              tabIndex={index === focusIndex ? 0 : -1}
              className="lf-bed-picker__target"
              style={{ left: position.point.x, top: position.point.y }}
              onClick={() => choose(position.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {isChecked && props.marker === 'home' ? (
                <HomeGlyph />
              ) : (
                <span className="lf-bed-picker__dot" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </span>
      <span id={captionId} className="lf-bed-picker__caption">
        {pickerCaption(props.marker, props.value)}
      </span>
    </span>
  );
}

function pickerCaption(marker: 'origin' | 'home', value: Origin): string {
  const label = bedPositionLabel(value);
  if (marker === 'home') return `Home: ${label.toLowerCase()}`;
  const words = originAxisWords(value);
  return `${label}: +X ${words.x}, +Y ${words.y}`;
}
