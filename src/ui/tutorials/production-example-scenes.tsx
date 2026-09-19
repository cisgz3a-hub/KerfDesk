/* eslint-disable no-restricted-syntax -- SVG colours distinguish schematic stock, cutouts and toolpaths, not app chrome. */
import { useId } from 'react';
import {
  Arrow,
  GOLD,
  INK,
  Label,
  TEAL,
  TEAL_LIGHT,
  type SceneProps,
} from './illustration-primitives';

export function BoxFitScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <Label x={260} y={28}>
        {
          [
            'Build a clearance ladder',
            'Cut the tab comb and slot strip',
            'Test matching rungs, then transfer the clearance',
          ][phase]
        }
      </Label>
      <CouponStrip kind="slots" y={70} phase={phase} />
      <CouponStrip kind="comb" y={165} phase={phase} />
      <Label x={260} y={57}>
        Slot strip
      </Label>
      <Label x={260} y={140}>
        Tab comb
      </Label>
      {Array.from({ length: 5 }, (_, rung) => (
        <text key={rung} x={123 + rung * 56} y="222" textAnchor="middle" fontSize="12" fill={INK}>
          {rung}
        </text>
      ))}
      <Label x={260} y={251}>
        {phase === 2
          ? 'Chosen clearance = start + rung number × step'
          : 'Rung 0 starts at the narrow-margin end'}
      </Label>
      <text x="260" y="272" textAnchor="middle" fontSize="11" fill={INK}>
        {phase === 2
          ? 'Choose from the physical fit; use its value directly in Box Generator'
          : 'Numbers are diagram labels, not extra marks cut into the strips'}
      </text>
    </g>
  );
}

function CouponStrip({
  kind,
  y,
  phase,
}: SceneProps & {
  readonly kind: 'comb' | 'slots';
  readonly y: number;
}): JSX.Element {
  const isComb = kind === 'comb';
  const points = ['M0 0'];
  for (let rung = 0; rung < 5; rung += 1) {
    const allowance = (1 + rung * 1.2) / 4;
    const start = 14 + rung * 56 + (isComb ? allowance : -allowance);
    const end = 42 + rung * 56 + (isComb ? -allowance : allowance);
    const tip = isComb ? -16 : 16;
    points.push(`H${start}V${tip}H${end}V0`);
  }
  points.push('H322V30H0Z');
  return (
    <g transform={`translate(95 ${y})`}>
      <path
        d={points.join(' ')}
        fill={phase === 0 ? 'white' : '#e5c99c'}
        stroke="#8d6637"
        strokeWidth="2"
      />
      {phase === 2 ? (
        <rect
          x="118"
          y={isComb ? -22 : -6}
          width="44"
          height={isComb ? 57 : 42}
          rx="3"
          fill="none"
          stroke={TEAL}
          strokeWidth="2"
          strokeDasharray="4 3"
        />
      ) : null}
    </g>
  );
}

const TILED_OUTLINE = 'M68 95H174L201 75H288V108H373L455 164L405 185H314V158H189L127 199H68Z';

export function CncTilingScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <Label x={260} y={29}>
        {
          [
            'One large design',
            'Overlapping regions of the same design',
            'Separate files contain their clipped tile output',
          ][phase]
        }
      </Label>
      {phase === 2 ? <ExportedTilePanels /> : <TilingLayout phase={phase} />}
      <Label x={260} y={258}>
        {phase === 2
          ? 'Index and re-reference the stock for each file'
          : 'Tile step = tile size − effective overlap'}
      </Label>
      <text x="260" y="278" textAnchor="middle" fontSize="11" fill={INK}>
        Tiling divides the output; it does not reposition the physical stock.
      </text>
    </g>
  );
}

function TilingLayout({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="52" y="65" width="424" height="145" fill="#ead9b7" stroke="#a98756" />
      <path d={TILED_OUTLINE} fill={TEAL_LIGHT} stroke={TEAL} strokeWidth="3" />
      {phase === 1 ? (
        <g>
          <rect x="252" y="65" width="24" height="145" fill="#f5c26980" />
          <rect
            x="52"
            y="65"
            width="224"
            height="145"
            fill="none"
            stroke={GOLD}
            strokeWidth="2"
            strokeDasharray="6 4"
          />
          <rect
            x="252"
            y="65"
            width="224"
            height="145"
            fill="none"
            stroke={INK}
            strokeWidth="2"
            strokeDasharray="6 4"
          />
          <Label x={153} y={232}>
            Tile 1
          </Label>
          <Label x={264} y={54}>
            Overlap
          </Label>
          <Label x={375} y={232}>
            Tile 2
          </Label>
        </g>
      ) : (
        <Label x={260} y={232}>
          Continuous artwork before tiling
        </Label>
      )}
    </g>
  );
}

function ExportedTilePanels(): JSX.Element {
  return (
    <g>
      <TilePanel x={32} sourceX={52} label="Row 1 · column 1" />
      <TilePanel x={281} sourceX={252} label="Row 1 · column 2" />
    </g>
  );
}

function TilePanel({
  x,
  sourceX,
  label,
}: {
  readonly x: number;
  readonly sourceX: number;
  readonly label: string;
}): JSX.Element {
  const clipId = `${useId()}-tile`;
  return (
    <g transform={`translate(${x} 82)`}>
      <defs>
        <clipPath id={clipId}>
          <rect width="202" height="131" />
        </clipPath>
      </defs>
      <rect width="202" height="131" fill="#ead9b7" stroke="#a98756" />
      <g clipPath={`url(#${clipId})`}>
        <g transform={`scale(0.9) translate(${-sourceX} -65)`}>
          <path d={TILED_OUTLINE} fill={TEAL_LIGHT} stroke={TEAL} strokeWidth="3" />
        </g>
      </g>
      <Label x={101} y={154}>
        {label}
      </Label>
    </g>
  );
}

const INLAY_OUTLINE =
  'M8 0H86Q94 0 94 8V26Q94 34 86 34H42Q34 34 34 42V86Q34 94 26 94H8Q0 94 0 86V8Q0 0 8 0Z';

export function CncInlayScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <Label x={260} y={30}>
        {
          [
            'Start with one closed outline',
            'Create a pocket and a mirrored insert',
            'Inspect both depths, fit and the full footprint',
          ][phase]
        }
      </Label>
      {phase === 0 ? (
        <g>
          <path
            transform="translate(213 83)"
            d={INLAY_OUTLINE}
            fill={TEAL_LIGHT}
            stroke={TEAL}
            strokeWidth="2"
          />
          <Label x={260} y={210}>
            Shared source geometry
          </Label>
        </g>
      ) : (
        <InlayPair phase={phase} />
      )}
      <Label x={260} y={254}>
        {phase === 0
          ? 'Inlay pair (pocket + insert)'
          : 'Fit clearance is checked on a physical sample'}
      </Label>
      <text x="260" y="275" textAnchor="middle" fontSize="11" fill={INK}>
        Schematic plan view · the two pieces have separate cutting depths
      </text>
    </g>
  );
}

function InlayPair({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="62" y="66" width="164" height="140" rx="3" fill="#e5c99c" stroke="#a98756" />
      <rect x="296" y="66" width="164" height="140" rx="3" fill="#c7945d" stroke="#8d6637" />
      <path
        transform="translate(98 86)"
        d={INLAY_OUTLINE}
        fill={TEAL_LIGHT}
        stroke={TEAL}
        strokeWidth="3"
      />
      <g transform="translate(425 86) scale(-1 1)">
        <path d={INLAY_OUTLINE} fill="#e5c99c" stroke="#714d2c" strokeWidth="3" />
        {phase === 2 ? (
          <path d={INLAY_OUTLINE} fill="none" stroke={TEAL} strokeWidth="9" strokeOpacity="0.35" />
        ) : null}
      </g>
      <path d="M192 54v25M331 54v25" stroke={GOLD} strokeDasharray="3 3" />
      <Arrow x={192} y={54} width={139} />
      <Label x={260} y={78}>
        Pair spacing
      </Label>
      <Label x={145} y={229}>
        {phase === 2 ? 'Pocket depth' : 'Pocket / recess'}
      </Label>
      <Label x={378} y={229}>
        {phase === 2 ? 'Insert depth' : 'Mirrored insert'}
      </Label>
    </g>
  );
}
