/* eslint-disable no-restricted-syntax -- Fixed SVG illustration colours represent sample artwork, not application chrome. */
import {
  Arrow,
  INK,
  Label,
  MUTED,
  TEAL,
  TEAL_LIGHT,
  type SceneProps,
} from './illustration-primitives';

export function ProjectFileScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="45" y="61" width="183" height="148" rx="5" fill="white" stroke="#cbdad8" />
      <rect
        x="81"
        y="96"
        width="111"
        height="78"
        rx="3"
        fill={TEAL_LIGHT}
        stroke={TEAL}
        strokeWidth="3"
      />
      <Label x={137} y={43}>
        Canvas
      </Label>
      {phase === 0 ? (
        <g transform="translate(280 135) rotate(180)">
          <Arrow x={0} y={0} width={36} />
        </g>
      ) : (
        <Arrow x={244} y={135} width={36} />
      )}
      <path d="M309 44H430L470 84V216H309Z" fill="white" stroke={TEAL} strokeWidth="2" />
      <path d="M430 44V84H470" fill={TEAL_LIGHT} stroke={TEAL} strokeWidth="2" />
      <text x="389" y="123" textAnchor="middle" fill={INK} fontSize="17" fontWeight="650">
        My project
      </text>
      <text x="389" y="151" textAnchor="middle" fill={TEAL} fontSize="13">
        Artwork + settings
      </text>
      <Label x={260} y={252}>
        {phase === 0 ? 'Open an editable project' : 'Save an editable project file'}
      </Label>
    </g>
  );
}

export function ProjectNotesScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="76" y="36" width="368" height="185" rx="7" fill="white" stroke="#cbdad8" />
      <Label x={260} y={65}>
        Project Notes
      </Label>
      {['Material and thickness', 'Results from actual tests', 'Things still to check'].map(
        (line, index) => (
          <g key={line}>
            <path d={`M99 ${111 + index * 39}H421`} stroke="#dfe9e5" />
            {phase > 0 ? (
              <text x="101" y={102 + index * 39} fill={INK} fontSize="15">
                {line}
              </text>
            ) : null}
          </g>
        ),
      )}
      <Label x={260} y={252}>
        {phase === 2 ? 'Save Notes, then File → Save' : 'Keep useful details with your project'}
      </Label>
    </g>
  );
}

export function WorkspaceBasicsScene({ phase }: SceneProps): JSX.Element {
  const collapsed = phase === 2;
  return (
    <g>
      <rect x="28" y="64" width="42" height="143" rx="4" fill="white" stroke="#cbdad8" />
      <path d="M39 91h20v16H39Z" fill={TEAL_LIGHT} stroke={TEAL} strokeWidth="2" />
      <circle cx="49" cy="136" r="10" fill="none" stroke={TEAL} strokeWidth="2" />
      <text x="49" y="179" textAnchor="middle" fontSize="22" fill={TEAL}>
        T
      </text>
      <Label x={49} y={47}>
        Tools
      </Label>
      <rect
        x="83"
        y="64"
        width={collapsed ? 372 : 277}
        height="143"
        rx="4"
        fill="white"
        stroke="#cbdad8"
      />
      <rect
        x={collapsed ? 203 : phase === 1 ? 133 : 155}
        y={phase === 1 ? 83 : 96}
        width={phase === 1 ? 176 : 132}
        height={phase === 1 ? 104 : 78}
        rx="3"
        fill={TEAL_LIGHT}
        stroke={TEAL}
        strokeWidth="2"
      />
      <Label x={collapsed ? 269 : 221} y={47}>
        Canvas
      </Label>
      <rect
        x={collapsed ? 467 : 372}
        y="64"
        width={collapsed ? 24 : 119}
        height="143"
        rx="4"
        fill="white"
        stroke="#cbdad8"
      />
      <Label x={collapsed ? 479 : 431} y={47}>
        Panels
      </Label>
      {collapsed ? (
        <path d="m475 130 8 6-8 6" fill="none" stroke={MUTED} strokeWidth="2" />
      ) : (
        <>
          <Label x={431} y={101}>
            Artwork /
          </Label>
          <Label x={431} y={122}>
            Operations
          </Label>
          <path d="M382 145H481" stroke="#dfe9e5" />
          <Label x={431} y={179}>
            Machine
          </Label>
        </>
      )}
      <Label x={260} y={252}>
        {
          [
            'Tools, canvas and settings',
            '+ / − to zoom · Space + drag to pan · F to fit',
            'Collapse a panel for more canvas space',
          ][phase]
        }
      </Label>
    </g>
  );
}
