/* eslint-disable no-restricted-syntax -- Fixed SVG illustration colours represent sample artwork and materials, not application chrome. */
import {
  Arrow,
  Handles,
  INK,
  Label,
  MUTED,
  Pointer,
  TEAL,
  TEAL_LIGHT,
  type SceneProps,
} from './illustration-primitives';
import type { TutorialVisual } from './tutorial-types';

const STAR = '0,-52 15,-16 52,-16 23,8 33,47 0,25 -33,47 -23,8 -52,-16 -15,-16';

export function ShapeScene({
  phase,
  kind,
}: SceneProps & { readonly kind: TutorialVisual }): JSX.Element {
  const attrs = { stroke: TEAL, strokeWidth: 3, fill: phase === 0 ? 'none' : TEAL_LIGHT };
  const shapes: Partial<Record<TutorialVisual, JSX.Element>> = {
    rectangle: <rect x="137" y="68" width="238" height="135" rx="2" {...attrs} />,
    ellipse: <ellipse cx="256" cy="135" rx="115" ry="72" {...attrs} />,
    circle: <circle cx="256" cy="135" r="75" {...attrs} />,
    arc: (
      <g>
        <circle cx="256" cy="143" r="80" fill="none" stroke={MUTED} strokeDasharray="4 4" />
        <path
          d={phase === 0 ? 'M256 143H336' : 'M336 143A80 80 0 0 0 200 86'}
          fill="none"
          stroke={TEAL}
          strokeWidth="4"
        />
        <circle cx="256" cy="143" r="4" fill={TEAL} />
        <path d="M256 143 200 86" stroke={MUTED} />
      </g>
    ),
    polygon: <polygon points="151,133 203,58 307,58 359,133 307,208 203,208" {...attrs} />,
    star: <polygon points={STAR} transform="translate(255 133) scale(1.5)" {...attrs} />,
    line: <path d="M130 195 375 75" fill="none" stroke={TEAL} strokeWidth="4" />,
    polyline: (
      <polyline
        points={
          phase === 0
            ? '130,195 190,85'
            : phase === 1
              ? '130,195 190,85 285,145'
              : '130,195 190,85 285,145 375,75'
        }
        fill="none"
        stroke={TEAL}
        strokeWidth="4"
      />
    ),
  };
  return (
    <g opacity={phase === 0 ? 0.6 : 1}>
      {shapes[kind]}
      {phase < 2 ? (
        <ShapePointer phase={phase} kind={kind} />
      ) : (
        <Handles x={130} y={53} w={250} h={156} />
      )}
      <Label x={260} y={247}>
        {phase === 0
          ? 'Choose the tool'
          : phase === 1
            ? 'Place and size the shape'
            : 'Editable vector artwork'}
      </Label>
    </g>
  );
}

function ShapePointer({
  phase,
  kind,
}: SceneProps & { readonly kind: TutorialVisual }): JSX.Element {
  if (kind === 'circle') return <Pointer x={phase === 0 ? 256 : 331} y={135} />;
  if (kind === 'arc') return <Pointer x={phase === 0 ? 256 : 336} y={143} />;
  if (kind === 'line') return <Pointer x={phase === 0 ? 130 : 375} y={phase === 0 ? 195 : 75} />;
  return <Pointer x={phase === 0 ? 137 : 370} y={phase === 0 ? 68 : 195} />;
}

export function SelectScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect
        x="94"
        y="73"
        width="130"
        height="105"
        rx="3"
        fill="none"
        stroke={MUTED}
        strokeDasharray="5 5"
      />
      <g
        data-move="true"
        transform={
          phase === 0
            ? 'translate(94 73)'
            : phase === 1
              ? 'translate(212 90)'
              : 'translate(247 62) rotate(12 78 63)'
        }
      >
        <rect
          width={phase === 2 ? 156 : 130}
          height={phase === 2 ? 126 : 105}
          rx="3"
          fill={TEAL_LIGHT}
          stroke={TEAL}
          strokeWidth="2"
        />
        <Handles x={-5} y={-5} w={phase === 2 ? 166 : 140} h={phase === 2 ? 136 : 115} />
      </g>
      {phase > 0 ? <Arrow x={148} y={215} width={172} /> : null}
      <Pointer x={phase === 0 ? 165 : 335} y={phase === 0 ? 122 : 163} />
      <Label x={260} y={249}>
        {['Select the artwork', 'Move the selection', 'Resize or rotate using handles'][phase]}
      </Label>
    </g>
  );
}

export function NodeScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <path
        d={
          phase === 0
            ? 'M95 190 200 80 310 160 420 80'
            : 'M95 190C130 150 150 60 200 80S260 200 310 160S390 120 420 80'
        }
        fill="none"
        stroke={TEAL}
        strokeWidth="4"
      />
      {[
        [95, 190],
        [200, 80],
        [310, 160],
        [420, 80],
      ].map(([x, y]) => (
        <rect
          key={x}
          x={(x ?? 0) - 5}
          y={(y ?? 0) - 5}
          width="10"
          height="10"
          fill="white"
          stroke={TEAL}
          strokeWidth="2"
        />
      ))}
      {phase > 0 ? (
        <g stroke="#b86b16" strokeWidth="2">
          <path d="M150 60 250 100" />
          <circle cx="150" cy="60" r="5" fill="white" />
          <circle cx="250" cy="100" r="5" fill="white" />
        </g>
      ) : null}
      <Pointer x={phase === 0 ? 200 : 250} y={phase === 0 ? 80 : 102} />
      <Label x={260} y={246}>
        {phase === 0
          ? 'Select a path node'
          : phase === 1
            ? 'Adjust its handles'
            : 'The path changes, not the whole object'}
      </Label>
    </g>
  );
}

export function MeasureScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect
        x="100"
        y="74"
        width="310"
        height="126"
        fill={TEAL_LIGHT}
        stroke={TEAL}
        strokeWidth="2"
      />
      <g stroke={INK} fill={INK}>
        <circle cx="100" cy="215" r="3" />
        {phase > 0 ? (
          <>
            <path d="M100 215H410M100 205v20m310-20v20" />
            <circle cx="410" cy="215" r="3" />
          </>
        ) : null}
      </g>
      <Pointer x={phase === 0 ? 100 : 410} y={215} />
      <Label x={255} y={phase > 0 ? 244 : 50}>
        {phase > 0 ? 'Distance · ΔX · ΔY · angle' : 'Pick the first point'}
      </Label>
    </g>
  );
}

export function TextScene({
  phase,
  curved = false,
}: SceneProps & { readonly curved?: boolean }): JSX.Element {
  return (
    <g>
      <path
        d={curved ? 'M80 180Q260 25 440 180' : 'M65 190H450'}
        fill="none"
        stroke={MUTED}
        strokeDasharray="4 4"
      />
      <g fill={TEAL} fontSize="65" fontWeight="650" fontFamily="Georgia, serif">
        {curved && phase > 0 ? (
          'Make'.split('').map((letter, index) => (
            <text
              key={index}
              x={120 + index * 66}
              y={[135, 105, 105, 135][index]}
              transform={`rotate(${[-25, -10, 10, 25][index]} ${120 + index * 66} ${[135, 105, 105, 135][index]})`}
            >
              {letter}
            </text>
          ))
        ) : (
          <text x="130" y="165">
            {phase === 0 ? 'M' : 'Make'}
          </text>
        )}
      </g>
      {phase < 2 ? (
        <path d="M325 105v73" stroke={INK} strokeWidth="2" />
      ) : (
        <Handles x={89} y={70} w={342} h={130} />
      )}
      <Label x={260} y={245}>
        {phase === 0
          ? 'Click and type'
          : phase === 1
            ? curved
              ? 'Bend or follow a path'
              : 'Choose font, size and spacing'
            : 'Keep text editable with Done'}
      </Label>
    </g>
  );
}

export function CornerScene({
  phase,
  kind,
}: SceneProps & { readonly kind: 'fillet' | 'trim' | 'offset' }): JSX.Element {
  const corner =
    kind === 'fillet'
      ? 'M150 100Q150 65 185 65H325Q360 65 360 100V160Q360 195 325 195H185Q150 195 150 160Z'
      : 'M150 100 185 65H325L360 100V160L325 195H185L150 160Z';
  return (
    <g>
      <path
        d={phase > 0 && kind !== 'offset' ? corner : 'M150 195V65H360V195Z'}
        fill={TEAL_LIGHT}
        stroke={TEAL}
        strokeWidth="3"
      />
      {kind === 'offset' && phase > 0 ? (
        <rect
          x="131"
          y="46"
          width="248"
          height="168"
          rx="10"
          fill="none"
          stroke="#b86b16"
          strokeWidth="2"
          strokeDasharray="6 4"
        />
      ) : null}
      {phase < 2 ? <Pointer x={150} y={65} /> : null}
      <Label x={260} y={250}>
        {phase === 0
          ? 'Choose geometry to edit'
          : {
              fillet: 'Round the rectangle corners',
              trim: 'Bevel the rectangle corners',
              offset: 'Offset follows the original outline',
            }[kind]}
      </Label>
    </g>
  );
}

export function DogboneScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="100" y="35" width="320" height="192" rx="5" fill="#e9ddc7" stroke="#cbbd9d" />
      <rect
        x="159"
        y="83"
        width="204"
        height="105"
        rx={phase === 0 ? 15 : 0}
        fill={TEAL_LIGHT}
        stroke={TEAL}
        strokeWidth="2.5"
      />
      {phase > 0
        ? [
            [159, 83],
            [363, 83],
            [159, 188],
            [363, 188],
          ]
            .slice(0, phase === 1 ? 1 : 4)
            .map(([x, y], index) => (
              <circle
                key={index}
                cx={x}
                cy={y}
                r="14"
                fill={TEAL_LIGHT}
                stroke={TEAL}
                strokeWidth="2.5"
              />
            ))
        : null}
      {phase === 1 ? <Pointer x={159} y={83} /> : null}
      <Label x={260} y={254}>
        {
          [
            'Round bits leave curved inside corners',
            'Add clearance at an inside corner',
            'Overcuts let a square mating part fit',
          ][phase]
        }
      </Label>
    </g>
  );
}
