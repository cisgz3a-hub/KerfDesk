/* eslint-disable no-restricted-syntax -- Fixed SVG illustration colours represent sample artwork and materials, not application chrome. */
import {
  Label,
  MUTED,
  Pointer,
  TEAL,
  TEAL_LIGHT,
  type SceneProps,
} from './illustration-primitives';
export function ArrangeScene({
  phase,
  kind,
}: SceneProps & { readonly kind: 'align' | 'distribute' | 'array' | 'nest' }): JSX.Element {
  if (kind === 'align' && phase === 2) return <CenteredArtworkScene />;
  const layouts = arrangementPositions(phase);
  const referenceIndex = kind === 'align' ? 2 : 0;
  return (
    <g>
      {kind === 'align' && phase > 0 ? (
        <path d="M337 35v205" stroke="#b86b16" strokeDasharray="5 4" />
      ) : null}
      {kind === 'nest' ? (
        <rect
          x="137"
          y="64"
          width="185"
          height="132"
          fill="none"
          stroke={MUTED}
          strokeDasharray="5 4"
        />
      ) : null}
      {layouts[kind].map((point, index) => (
        <g key={index} data-move="true" transform={`translate(${point[0]} ${point[1]})`}>
          <rect
            width="70"
            height="45"
            rx={kind === 'nest' && index % 2 === 0 ? 20 : 3}
            fill={index === referenceIndex ? TEAL : TEAL_LIGHT}
            stroke={TEAL}
            strokeWidth="2"
          />
          <text
            x="35"
            y="29"
            textAnchor="middle"
            fontSize="14"
            fill={index === referenceIndex ? 'white' : TEAL}
          >
            {index + 1}
          </text>
        </g>
      ))}
      <Label x={260} y={251}>
        {phase === 0
          ? 'Start with selected artwork'
          : {
              align: 'Edges share a reference',
              distribute: 'Even spacing between objects',
              array: 'Repeat with controlled spacing',
              nest: 'Pack within the available area',
            }[kind]}
      </Label>
    </g>
  );
}

function CenteredArtworkScene(): JSX.Element {
  return (
    <g>
      <rect
        x="150"
        y="65"
        width="220"
        height="140"
        rx="3"
        fill={TEAL_LIGHT}
        stroke={TEAL}
        strokeWidth="2"
      />
      <path d="M260 46V224M131 135H389" stroke={MUTED} strokeDasharray="5 4" />
      <rect x="215" y="107.5" width="90" height="55" rx="3" fill={TEAL} />
      <text x="260" y="140" textAnchor="middle" fontSize="14" fill="white">
        Design
      </text>
      <Label x={260} y={36}>
        Reference shape
      </Label>
      <Label x={260} y={251}>
        Both centres line up
      </Label>
    </g>
  );
}

export function BooleanScene({
  phase,
  kind,
}: SceneProps & { readonly kind: 'weld' | 'subtract' | 'intersect' | 'exclude' }): JSX.Element {
  const resultPaths = {
    weld: 'M140 70h130v40h100v120H240v-40H140Z',
    subtract: 'M140 70h130v40h-30v80H140Z',
    intersect: 'M240 110h30v80h-30Z',
    exclude: 'M140 70h130v40h-30v80H140ZM270 110h100v120H240v-40h30Z',
  };
  return (
    <g>
      {phase < 2 ? (
        <>
          <rect
            x="140"
            y="60"
            width="130"
            height="120"
            fill={TEAL_LIGHT}
            stroke={TEAL}
            strokeWidth="2"
          />
          <rect
            x="240"
            y="100"
            width="130"
            height="120"
            fill="#edc28b"
            fillOpacity="0.75"
            stroke="#b86b16"
            strokeWidth="2"
          />
        </>
      ) : (
        <path
          d={resultPaths[kind]}
          transform="translate(0 -10)"
          fill={TEAL_LIGHT}
          stroke={TEAL}
          strokeWidth="3"
          fillRule="evenodd"
        />
      )}
      {phase === 1 ? <Pointer x={264} y={128} /> : null}
      <Label x={260} y={253}>
        {phase < 2
          ? 'Two overlapping closed shapes'
          : {
              weld: 'One united outline',
              subtract: 'Upper shape removed from lower',
              intersect: 'Only the shared area',
              exclude: 'Overlap removed from both',
            }[kind]}
      </Label>
    </g>
  );
}

function arrangementPositions(
  phase: number,
): Record<'align' | 'distribute' | 'array' | 'nest', number[][]> {
  return {
    align:
      phase === 0
        ? [
            [85, 65],
            [198, 117],
            [337, 166],
          ]
        : [
            [337, 65],
            [337, 117],
            [337, 166],
          ],
    distribute:
      phase === 0
        ? [
            [50, 115],
            [152, 115],
            [385, 115],
          ]
        : [
            [50, 115],
            [217.5, 115],
            [385, 115],
          ],
    array:
      phase === 0
        ? [[85, 45]]
        : Array.from({ length: 9 }, (_, i) => [85 + (i % 3) * 140, 45 + Math.floor(i / 3) * 64]),
    nest:
      phase === 0
        ? [
            [50, 56],
            [335, 133],
            [193, 169],
            [348, 49],
          ]
        : [
            [147, 74],
            [233, 74],
            [147, 139],
            [233, 139],
          ],
  };
}
