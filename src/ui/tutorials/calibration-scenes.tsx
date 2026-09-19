/* eslint-disable no-restricted-syntax -- Fixed SVG illustration colours represent sample artwork and materials, not application chrome. */
import {
  GOLD,
  INK,
  Label,
  MUTED,
  TEAL,
  TEAL_LIGHT,
  type SceneProps,
} from './illustration-primitives';

export function ProbeScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <ProbeZView phase={phase} />
      <ProbeCornerView phase={phase} />
      <path d="M260 47V232" stroke="#cddbd9" strokeDasharray="4 5" />
      <Label x={260} y={268}>
        {
          [
            'Describe the actual plate and cutter',
            'Observe the complete contact cycle',
            'Remove the plate and lead after successful zero',
          ][phase]
        }
      </Label>
    </g>
  );
}

function ProbeZView({ phase }: SceneProps): JSX.Element {
  const tipY = phase === 1 ? 164 : 132;
  return (
    <g>
      <Label x={143} y={31}>
        Z-only: side view
      </Label>
      <rect x="49" y="184" width="190" height="35" fill="#e9ddc7" stroke="#cbbd9d" />
      {phase < 2 ? (
        <g>
          <rect
            x="91"
            y="164"
            width="100"
            height="20"
            fill="#b4c4ca"
            stroke={INK}
            strokeWidth="2"
          />
          <path d="M201 164h16m-8 0v20m-8 0h16" fill="none" stroke={GOLD} strokeWidth="2" />
          <Label x={207} y={152}>
            Plate
          </Label>
        </g>
      ) : (
        <path d="M43 184H245" stroke={GOLD} strokeWidth="2" strokeDasharray="5 4" />
      )}
      <g data-move="true" transform={`translate(130 ${tipY - 68})`}>
        <rect width="24" height="68" fill={TEAL_LIGHT} stroke={TEAL} strokeWidth="2" />
        <path d="M0 46 24 30m-24 30 24-16" stroke={TEAL} strokeWidth="2" />
      </g>
      {phase === 1 ? <circle cx="142" cy="164" r="5" fill={GOLD} /> : null}
      <Label x={143} y={240}>
        {phase < 2 ? 'Measured plate thickness' : 'Stock top = work Z zero'}
      </Label>
    </g>
  );
}

function ProbeCornerView({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <Label x={385} y={31}>
        XYZ adds corner contacts
      </Label>
      <rect x="322" y="101" width="153" height="116" fill="#e9ddc7" stroke="#cbbd9d" />
      {phase < 2 ? (
        <g>
          <rect
            x="322"
            y="101"
            width="88"
            height="58"
            fill="#b4c4ca"
            stroke={INK}
            strokeWidth="2"
          />
          <path
            d="M322 169h44m-44-5v10m44-10v10M421 101v29m-5-29h10m-10 29h10"
            fill="none"
            stroke={GOLD}
            strokeWidth="2"
          />
          <path d="M357 130h18m-9-9v18" stroke={MUTED} strokeDasharray="3 2" />
          <circle
            cx={phase === 0 ? 366 : 314}
            cy="130"
            r="8"
            fill="white"
            stroke={phase === 1 ? TEAL : MUTED}
            strokeWidth="2"
          />
          {phase === 1 ? (
            <g>
              <circle cx="366" cy="93" r="8" fill="white" stroke={TEAL} strokeWidth="2" />
              <circle cx="322" cy="130" r="4" fill={GOLD} />
              <circle cx="366" cy="101" r="4" fill={GOLD} />
            </g>
          ) : null}
          <Label x={389} y={201}>
            {phase === 0 ? 'Start above plate centre' : 'X / Y contact positions'}
          </Label>
        </g>
      ) : null}
      <path d="M311 101h22m-11-11v22" stroke={GOLD} strokeWidth="2.5" />
      <Label x={389} y={240}>
        {phase < 2 ? 'Measured plate centre offsets' : 'XY zero at chosen corner'}
      </Label>
    </g>
  );
}

export function ScanOffsetScene({ phase }: SceneProps): JSX.Element {
  const displacement = phase === 2 ? 0 : 26;
  return (
    <g>
      <Label x={260} y={31}>
        {
          ['Uncorrected baseline', 'Measure the full signed gap', 'Target result: aligned rows'][
            phase
          ]
        }
      </Label>
      <rect x="54" y="52" width="328" height="153" rx="5" fill="#e9ddc7" stroke="#cbbd9d" />
      <path d="M84 62V193M320 62V193" fill="none" stroke={MUTED} strokeDasharray="4 4" />
      {Array.from({ length: 6 }, (_, index) => {
        const reverse = index % 2 === 1;
        const shift = reverse ? displacement : 0;
        const start = 84 + shift;
        const end = 320 + shift;
        const y = 77 + index * 20;
        return (
          <path
            key={index}
            d={reverse ? `M${end} ${y}H${start}m7-4-7 4 7 4` : `M${start} ${y}H${end}m-7-4 7 4-7 4`}
            fill="none"
            stroke={reverse ? GOLD : TEAL}
            strokeWidth="2.5"
          />
        );
      })}
      <text x="390" y="82" fill={TEAL} fontSize="12">
        Forward →
      </text>
      <text x="390" y="103" fill={GOLD} fontSize="12">
        ← Reverse
      </text>
      {phase === 1 ? (
        <g>
          <path d="M320 184v15m0-7h26m0-8v15" fill="none" stroke={INK} strokeWidth="2" />
          <Label x={336} y={224}>
            Signed gap
          </Label>
        </g>
      ) : (
        <Label x={260} y={224}>
          {phase === 0
            ? 'Enlarged view of one speed-labelled swatch'
            : 'Forward rows stay anchored'}
        </Label>
      )}
      <Label x={260} y={257}>
        {
          [
            'Measure displacement at each labelled speed',
            'Save the measured table; verification is still pending',
            'Verify alignment and placement on the physical coupon',
          ][phase]
        }
      </Label>
    </g>
  );
}

export function IntervalTestScene({ phase }: SceneProps): JSX.Element {
  const intervals = [6, 12, 20];
  return (
    <g>
      <Label x={260} y={30}>
        Same speed · same power
      </Label>
      {intervals.map((interval, index) => (
        <g key={interval} transform={`translate(${48 + index * 155} 77)`}>
          <rect width="114" height="122" rx="4" fill="#e9ddc7" stroke="#cbbd9d" />
          <Label x={57} y={-16}>
            {['Closer rows', 'Medium rows', 'Wider rows'][index]}
          </Label>
          {Array.from({ length: Math.floor(102 / interval) + 1 }, (_, row) => (
            <path
              key={row}
              d={`M10 ${10 + row * interval}h94`}
              fill="none"
              stroke={phase === 0 ? MUTED : TEAL}
              strokeWidth="2"
            />
          ))}
        </g>
      ))}
      <path d="M110 221H410m-7-5 7 5-7 5" stroke={GOLD} strokeWidth="2" fill="none" />
      <Label x={260} y={242}>
        Increasing line interval
      </Label>
      <Label x={260} y={267}>
        {
          [
            'Change spacing while holding speed and power steady',
            'Smaller intervals add more rows to the same area',
            'Compare real coverage and detail before saving an interval',
          ][phase]
        }
      </Label>
    </g>
  );
}
