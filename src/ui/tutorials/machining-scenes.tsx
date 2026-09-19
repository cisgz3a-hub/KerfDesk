/* eslint-disable no-restricted-syntax -- Fixed SVG illustration colours represent sample artwork and materials, not application chrome. */
import {
  Card,
  GOLD,
  INK,
  Label,
  MUTED,
  Pointer,
  TEAL,
  TEAL_LIGHT,
  type SceneProps,
} from './illustration-primitives';
import type { TutorialVisual } from './tutorial-types';

export function CutScene({
  phase,
  kind,
}: SceneProps & { readonly kind: TutorialVisual }): JSX.Element {
  const labels: Partial<Record<TutorialVisual, string>> = {
    'laser-line': 'Line follows the outline',
    'laser-fill': 'Fill covers a closed region',
    raster: 'Image scans row by row',
    profile: 'Tool centre follows the offset',
    engrave: 'Tool centre follows the drawn line',
    pocket: 'Pocket clears the inside',
    tabs: 'Tabs leave holding bridges',
  };
  const fill = kind === 'laser-fill' || kind === 'pocket' || kind === 'raster';
  return (
    <g>
      <rect x="67" y="57" width="260" height="155" rx="6" fill="#e9ddc7" stroke="#cbbd9d" />
      {kind === 'engrave' ? (
        <path
          d="M104 172 144 96 188 172 232 96 283 172"
          fill="none"
          stroke={MUTED}
          strokeWidth="2"
        />
      ) : (
        <rect
          x="100"
          y="83"
          width="193"
          height="103"
          rx="26"
          fill={phase > 0 && fill ? TEAL_LIGHT : 'none'}
          stroke={MUTED}
          strokeWidth="2"
        />
      )}
      {phase > 0 ? (
        kind === 'engrave' ? (
          <EngraveToolpath phase={phase} />
        ) : (
          <Toolpath kind={kind} phase={phase} />
        )
      ) : null}
      <Card
        x={348}
        y={67}
        width={149}
        title="Operation"
        rows={
          kind === 'engrave'
            ? ['Engrave / trace path', 'Cut depth / passes', 'Preview each stroke']
            : fill
              ? ['Area / interval', 'Feed or speed', 'Preview path']
              : ['Outline / cut type', 'Passes / depth', 'Preview path']
        }
        active={phase}
      />
      <Label x={260} y={251}>
        {phase === 0
          ? 'Start with artwork and an operation'
          : (labels[kind] ?? 'Preview the cutting path')}
      </Label>
    </g>
  );
}

function Toolpath({ kind, phase }: SceneProps & { readonly kind: TutorialVisual }): JSX.Element {
  const fill = kind === 'laser-fill' || kind === 'pocket' || kind === 'raster';
  if (fill)
    return (
      <g stroke={TEAL} fill="none" strokeWidth="2.5">
        {Array.from({ length: phase === 1 ? 4 : 9 }, (_, i) => (
          <path
            key={i}
            d={`M${116 - Math.min(i, 2) * 3} ${94 + i * 10}h${160 + Math.min(i, 2) * 6}`}
          />
        ))}
        <circle cx="275" cy={phase === 1 ? 124 : 174} r="7" fill="#fff" />
      </g>
    );
  if (kind === 'tabs')
    return (
      <g fill="none" stroke={TEAL} strokeWidth="3">
        <path d="M174 75H130Q90 75 90 115V155Q90 195 130 195H174M214 195h50q40 0 40-40v-40q0-40-40-40h-50" />
        <path d="M174 75h40m-40 120h40" stroke={GOLD} strokeWidth="8" />
        <Label x={198} y={142}>
          Holding tabs
        </Label>
      </g>
    );
  return (
    <g fill="none" stroke={TEAL} strokeWidth="3">
      <rect
        x={kind === 'profile' ? 92 : 100}
        y={kind === 'profile' ? 75 : 83}
        width={kind === 'profile' ? 209 : 193}
        height={kind === 'profile' ? 119 : 103}
        rx="30"
        strokeDasharray={phase === 1 ? '160 450' : undefined}
      />
      <circle cx="291" cy="96" r="9" fill="white" />
    </g>
  );
}

function EngraveToolpath({ phase }: SceneProps): JSX.Element {
  return (
    <g fill="none" stroke={TEAL} strokeWidth="3">
      <path
        d={phase === 1 ? 'M104 172 144 96 188 172' : 'M104 172 144 96 188 172 232 96 283 172'}
      />
      <circle cx={phase === 1 ? 188 : 283} cy="172" r="8" fill="white" />
    </g>
  );
}

export function VCarveScene({ phase }: SceneProps): JSX.Element {
  const bitTop = [16, 58, 86][phase] ?? 16;
  const tipY = bitTop + 114;
  const halfWidth = Math.max(0, ((tipY - 140) * 46) / 78);
  return (
    <g>
      <path d="M80 140H440V210H80Z" fill="#e9ddc7" stroke="#cbbd9d" strokeWidth="2" />
      {phase > 0 ? (
        <path
          d={`M${260 - halfWidth} 140 260 ${tipY} ${260 + halfWidth} 140Z`}
          fill="#f5f8f8"
          stroke={TEAL}
          strokeWidth="2"
        />
      ) : null}
      <g data-move="true" transform={`translate(260 ${bitTop})`}>
        <path d="M-46 0H46V36L0 114-46 36Z" fill={TEAL_LIGHT} stroke={TEAL} strokeWidth="2.5" />
        <path d="M0 44v62" stroke={MUTED} strokeDasharray="4 4" />
      </g>
      {phase > 0 ? (
        <g stroke={GOLD} strokeWidth="2">
          <path d={`M${260 - halfWidth} 145v-14m0 5h${halfWidth * 2}m0-5v14`} />
        </g>
      ) : null}
      <Label x={115} y={75}>
        V-bit
      </Label>
      <Label x={390} y={180}>
        Stock
      </Label>
      <Label x={260} y={251}>
        {phase === 0
          ? 'Set the actual bit angle and tip'
          : phase === 1
            ? 'Depth changes the groove width'
            : 'Inspect depth and clearance before cutting'}
      </Label>
    </g>
  );
}

export function DrillScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="105" y="47" width="300" height="173" rx="8" fill="#e9ddc7" stroke="#cbbd9d" />
      {[0, 1, 2].flatMap((x) =>
        [0, 1].map((y) => (
          <g key={`${x}${y}`} transform={`translate(${163 + x * 92} ${95 + y * 78})`}>
            <circle r="18" fill={phase === 2 ? '#5c615b' : 'none'} stroke={TEAL} strokeWidth="2" />
            <path d="M-26 0h52M0-26v52" stroke={phase === 0 ? MUTED : TEAL} strokeDasharray="3 3" />
          </g>
        )),
      )}
      {phase === 1 ? <Pointer x={163} y={95} /> : null}
      <Label x={260} y={251}>
        {
          [
            'Locate hole centres',
            'Set total depth and peck depth',
            'Preview one drilling sequence per centre',
          ][phase]
        }
      </Label>
    </g>
  );
}

export function ReliefScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <path d="M83 165 290 45 440 121 241 230Z" fill="#ded8c8" stroke="#b4ad9a" />
      {Array.from({ length: phase === 0 ? 5 : 13 }, (_, index) => (
        <path
          key={index}
          d={`M${100 + index * 9} ${162 + index * 4}Q${220 + index * 4} ${phase > 0 ? 6 + index * 7 : 110 + index * 3} ${309 + index * 9} ${68 + index * 5}`}
          fill="none"
          stroke={phase === 2 ? TEAL : MUTED}
          strokeWidth="2"
        />
      ))}
      <Label x={260} y={260}>
        {
          [
            'Import explicit height or mesh geometry',
            'Set size, depth and stock relationship',
            'Preview roughing and finishing paths',
          ][phase]
        }
      </Label>
    </g>
  );
}

export function MachineScene({
  phase,
  kind,
}: SceneProps & { readonly kind: 'machine' | 'origin' | 'frame' }): JSX.Element {
  const head = [
    [112, 95],
    [256, 95],
    [256, 193],
  ][phase] ?? [112, 95];
  return (
    <g>
      <rect
        x="45"
        y="36"
        width="276"
        height="194"
        rx="6"
        fill="#e3ebea"
        stroke={INK}
        strokeWidth="3"
      />
      <path d="M59 53v158m248-158v158" stroke={MUTED} strokeWidth="5" />
      <rect x="88" y="78" width="192" height="132" fill="#e9ddc7" stroke="#cbbd9d" />
      <text
        x="184"
        y="154"
        textAnchor="middle"
        fontSize="27"
        fontFamily="Georgia, serif"
        fill={TEAL}
      >
        Make
      </text>
      {kind === 'frame' ? (
        <path
          d={phase === 0 ? 'M106 191V96H265' : 'M106 191V96H265V191Z'}
          fill="none"
          stroke={TEAL}
          strokeWidth="3"
          strokeDasharray="8 4"
        />
      ) : null}
      {kind === 'origin' ? (
        <g stroke={GOLD} strokeWidth="2">
          <path d="M88 192v18h18m-18 0 32-32" />
          <circle cx={phase === 0 ? 88 : 184} cy={phase === 0 ? 210 : 145} r="10" fill="white" />
          <path d={phase === 0 ? 'M73 210h30m-15-15v30' : 'M169 145h30m-15-15v30'} />
        </g>
      ) : (
        <g data-move="true" transform={`translate(${head[0]} ${head[1]})`}>
          <path d="M-54-20H54" stroke={MUTED} strokeWidth="7" />
          <rect x="-13" y="-20" width="26" height="28" rx="3" fill={INK} />
          <circle cy="9" r="6" fill={TEAL_LIGHT} stroke={TEAL} />
        </g>
      )}
      <Card
        x={342}
        y={55}
        width={157}
        title={MACHINE_LABELS[kind].title}
        rows={MACHINE_LABELS[kind].rows}
        active={phase}
      />
      <Label x={260} y={258}>
        {MACHINE_LABELS[kind].caption}
      </Label>
    </g>
  );
}

const MACHINE_LABELS = {
  machine: {
    title: 'Machine setup',
    rows: ['Choose profile', 'Confirm controller', 'Save setup'],
    caption: 'Profile and controller are separate choices',
  },
  origin: {
    title: 'Job placement',
    rows: ['Choose Start from', 'Choose job origin', 'Verify with Frame'],
    caption: 'Match artwork to the physical material',
  },
  frame: {
    title: 'Run sequence',
    rows: ['Frame exact job', 'Start → Job Review', 'Confirm reviewed job'],
    caption: 'Framing checks the physical placement',
  },
};

export function RotaryScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <ellipse cx="175" cy="140" rx="40" ry="80" fill="#d1dfe0" stroke={INK} strokeWidth="2" />
      <path
        d="M175 60H340Q380 60 380 140T340 220H175Q215 220 215 140T175 60"
        fill={TEAL_LIGHT}
        stroke={TEAL}
        strokeWidth="2"
      />
      <ellipse cx="340" cy="140" rx="40" ry="80" fill="none" stroke={TEAL} strokeWidth="2" />
      {phase > 0 ? (
        <g>
          <text x="237" y="146" fontSize="24" fontFamily="Georgia, serif" fill={TEAL}>
            Make
          </text>
          <path d="M385 72q52 69 0 138m-4-18 4 18 17-7" fill="none" stroke={GOLD} strokeWidth="3" />
        </g>
      ) : null}
      <Label x={260} y={252}>
        {
          [
            'Measure the actual object diameter',
            'Match roller or chuck motion',
            'Verify the calibration before wrapping artwork',
          ][phase]
        }
      </Label>
    </g>
  );
}
