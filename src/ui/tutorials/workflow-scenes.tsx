/* eslint-disable no-restricted-syntax -- Fixed SVG illustration colours represent sample artwork and materials, not application chrome. */
import {
  Arrow,
  Card,
  GOLD,
  Handles,
  INK,
  Label,
  MUTED,
  Pointer,
  TEAL,
  TEAL_LIGHT,
  type SceneProps,
} from './illustration-primitives';

export function WorkspaceScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="38" y="38" width="285" height="187" rx="5" fill="white" stroke="#cbdad8" />
      <rect x="56" y="55" width="250" height="151" rx="4" fill="#edf4f1" stroke="#d2e5dd" />
      <path d="M85 175V105L180 70 277 105V175Z" fill={TEAL_LIGHT} stroke={TEAL} strokeWidth="2.5" />
      <text
        x="180"
        y="147"
        textAnchor="middle"
        fill={TEAL}
        fontFamily="Georgia,serif"
        fontSize="36"
      >
        Make
      </text>
      {phase === 0 ? <Handles x={77} y={62} w={207} h={122} /> : null}
      {phase === 2 ? (
        <path
          d="M78 184V63H286V184Z"
          fill="none"
          stroke={GOLD}
          strokeDasharray="6 4"
          strokeWidth="2"
        />
      ) : null}
      <Card
        x={342}
        y={51}
        width={155}
        title="Your first project"
        rows={['1  Add artwork', '2  Set operations', '3  Preview & Frame']}
        active={phase}
      />
      <Label x={260} y={256}>
        Artwork → operations → reviewed output
      </Label>
    </g>
  );
}

export function ImportScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      {['SVG / DXF', 'PNG / JPG', 'STL (CNC)'].map((label, i) => (
        <g key={label} transform={`translate(${45 + i * 12} ${47 + i * 47})`}>
          <rect width="136" height="44" rx="5" fill="white" stroke={phase === 0 ? MUTED : TEAL} />
          <text x="15" y="28" fontSize="14" fill={INK}>
            {label}
          </text>
        </g>
      ))}
      <Arrow x={230} y={139} width={46} />
      <rect x="311" y="57" width="161" height="152" rx="4" fill="white" stroke="#cbdad8" />
      {phase > 0 ? (
        <>
          <path
            d="M335 180 368 83 393 136 445 91V180Z"
            fill={TEAL_LIGHT}
            stroke={TEAL}
            strokeWidth="2"
          />
          {phase === 2 ? <Handles x={327} y={75} w={126} h={113} /> : <Pointer x={390} y={160} />}
        </>
      ) : null}
      <Label x={260} y={252}>
        {
          [
            'Choose the right source file',
            'Bring it into the workspace',
            'Check scale, position and operation',
          ][phase]
        }
      </Label>
    </g>
  );
}

export function LayersScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <path d="M70 85H210V187H70Z" fill="none" stroke={TEAL} strokeWidth="3" />
      <text
        x="140"
        y="147"
        textAnchor="middle"
        fontSize="34"
        fontFamily="Georgia,serif"
        fill={GOLD}
      >
        Make
      </text>
      <Arrow x={233} y={133} width={30} />
      <Card
        x={288}
        y={40}
        width={200}
        title="Artwork / Operations"
        rows={[
          'Artwork and selection',
          'Process & cutting values',
          'Show · Output · Run order',
          'Preview the enabled output',
        ]}
        active={phase === 2 ? 3 : phase}
      />
      <Label x={260} y={255}>
        {
          [
            'Select artwork to inspect',
            'Give each operation its purpose',
            'Visibility and output are separate',
          ][phase]
        }
      </Label>
    </g>
  );
}

export function PreviewScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="53" y="37" width="414" height="171" rx="4" fill="white" stroke="#cbdad8" />
      <path
        d="M104 165V80H220V165H104M281 165V80H407V165H281"
        fill="none"
        stroke="#bdcaca"
        strokeWidth="2"
      />
      <path
        d={
          phase === 0
            ? 'M104 165V80'
            : phase === 1
              ? 'M104 165V80H220V165H104'
              : 'M104 165V80H220V165H104M281 165V80H407V165H281'
        }
        fill="none"
        stroke={TEAL}
        strokeWidth="3.5"
      />
      {phase === 2 ? (
        <path d="M104 165H281" stroke={GOLD} strokeWidth="2" strokeDasharray="5 5" />
      ) : null}
      <circle
        cx={phase < 2 ? 104 : 281}
        cy={phase === 0 ? 80 : 165}
        r="7"
        fill={INK}
        stroke="white"
        strokeWidth="2"
      />
      <rect x="89" y="224" width="342" height="5" rx="2" fill="#ccd9d6" />
      <rect x="89" y="224" width={(phase + 1) * 114} height="5" rx="2" fill={TEAL} />
      <Label x={260} y={260}>
        Cutting path <tspan fill={GOLD}>·</tspan> travel moves <tspan fill={GOLD}>·</tspan> playback
        position
      </Label>
    </g>
  );
}

export function CodeScene({
  phase,
  consoleMode = false,
}: SceneProps & { readonly consoleMode?: boolean }): JSX.Element {
  const rows = consoleMode
    ? ['Connection / status', 'Read diagnostics', 'Review response', 'Copy or export log']
    : ['G90', 'G0 X10 Y10', 'G1 X40 Y10 F600', 'G1 X40 Y40', 'M5'];
  return (
    <g>
      <rect x="56" y="39" width="408" height="187" rx="8" fill={INK} />
      <text x="75" y="65" fill="#b0c6c7" fontSize="11">
        {consoleMode ? 'CONTROLLER CONSOLE — EXAMPLE' : 'PROGRAM INSPECTOR — ILLUSTRATION'}
      </text>
      {rows.map((row, i) => (
        <g key={row} transform={`translate(75 ${77 + i * 25})`}>
          {i === phase + 1 ? <rect x="-6" width="370" height="24" rx="3" fill="#0f766e" /> : null}
          <text x="0" y="17" fill="#aec8c9" fontFamily="monospace" fontSize="12">
            {i + 1}
          </text>
          <text x="32" y="17" fill="white" fontFamily="monospace" fontSize="13">
            {row}
          </text>
        </g>
      ))}
      <Label x={260} y={255}>
        {consoleMode
          ? 'Read the response before the next action'
          : 'Inspect the program and its motion together'}
      </Label>
    </g>
  );
}

export function LibraryScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <Card
        x={37}
        y={37}
        width={200}
        title="Search the library"
        rows={[
          'Search or filter',
          'Inspect the selected item',
          'Insert / apply explicitly',
          'Check the workspace',
        ]}
        active={phase}
      />
      <Arrow x={251} y={137} width={27} />
      <rect x="300" y="48" width="179" height="166" rx="6" fill="white" stroke="#cbdad8" />
      <path
        d="M342 166C326 102 353 71 432 78C436 141 397 180 342 166Z"
        fill={TEAL_LIGHT}
        stroke={TEAL}
        strokeWidth="2.5"
      />
      <path d="M338 177 413 94" stroke={TEAL} strokeWidth="2" />
      {phase === 2 ? <Handles x={321} y={63} w={130} h={128} /> : null}
      <Label x={260} y={255}>
        Reusable artwork and settings, applied deliberately
      </Label>
    </g>
  );
}

export function SettingsScene({
  phase,
  history = false,
}: SceneProps & { readonly history?: boolean }): JSX.Element {
  return (
    <g>
      <Card
        x={72}
        y={35}
        width={375}
        title={history ? 'Project history' : 'Settings for this task'}
        rows={
          history
            ? ['Original artwork', 'Move / adjust', 'Review change', 'Undo or restore deliberately']
            : [
                'Choose the relevant feature',
                'Check the values and units',
                'Preview the effect',
                'Apply when ready',
              ]
        }
        active={phase + 1}
      />
      <Pointer x={398} y={92 + phase * 30} />
      <Label x={260} y={255}>
        {history
          ? 'Review changes without guessing'
          : 'Change one setting, then inspect the result'}
      </Label>
    </g>
  );
}

export function BoxScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      {phase < 2 ? (
        <g>
          {[
            [87, 60],
            [198, 60],
            [309, 60],
            [87, 151],
            [198, 151],
            [309, 151],
          ].map(([x, y], i) => (
            <g
              key={i}
              transform={`translate(${x} ${y})`}
              fill={TEAL_LIGHT}
              stroke={TEAL}
              strokeWidth="2"
            >
              <path d="M0 10h15V0h15v10h15V0h15v10h20v15h10v15H80v15h10v15H60v10H45V70H30v10H15V70H0V50h10V35H0Z" />
            </g>
          ))}
        </g>
      ) : (
        <g stroke={TEAL} strokeWidth="2.5">
          <path d="M148 101 257 52 373 103 264 156Z" fill="#d1ede3" />
          <path d="M148 101V197L264 243V156Z" fill="#a8d5c9" />
          <path d="M264 156 373 103V193L264 243Z" fill="#7dbab0" />
          <path
            d="M172 114v13m24-3v14m25-3v14m26-3v14M281 148v13m25-25v14m25-27v14m25-26v14"
            fill="none"
          />
        </g>
      )}
      <Label x={260} y={phase === 2 ? 28 : 264}>
        {phase === 0
          ? 'Flat finger-joint panels'
          : phase === 1
            ? 'Match thickness and tested clearance'
            : 'Inspect the assembled preview'}
      </Label>
    </g>
  );
}

export function CalibrationScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <Label x={264} y={37}>
        Compare a controlled range
      </Label>
      {[0, 1, 2, 3, 4].flatMap((x) =>
        [0, 1, 2].map((y) => (
          <g key={`${x}${y}`} transform={`translate(${98 + x * 70} ${58 + y * 50})`}>
            <rect
              width="53"
              height="35"
              rx="3"
              fill={
                phase === 0
                  ? '#e9ddc7'
                  : `rgb(${210 - x * 26 - y * 12}, ${189 - x * 22 - y * 15}, ${150 - x * 17 - y * 13})`
              }
              stroke={phase === 2 && x === 2 && y === 1 ? TEAL : '#b8ae96'}
              strokeWidth={phase === 2 && x === 2 && y === 1 ? 4 : 1}
            />
          </g>
        )),
      )}
      <path
        d="M88 218H425m-8-5 8 5-8 5M65 195V58m-5 8 5-8 5 8"
        stroke={INK}
        strokeWidth="1.5"
        fill="none"
      />
      <Label x={260} y={249}>
        {
          [
            'Set ranges for the actual material',
            'Generate and review the test pattern',
            'Compare the physical samples and record a setting',
          ][phase]
        }
      </Label>
    </g>
  );
}
