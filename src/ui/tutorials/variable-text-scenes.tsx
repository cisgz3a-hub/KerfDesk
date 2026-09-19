/* eslint-disable no-restricted-syntax -- Fixed SVG illustration colours represent sample artwork and materials, not application chrome. */
import { Arrow, INK, Label, TEAL, TEAL_LIGHT, type SceneProps } from './illustration-primitives';

export function VariableTextScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="40" y="52" width="174" height="156" rx="7" fill="white" stroke="#cddbd9" />
      <Label x={127} y={76}>
        CSV records
      </Label>
      <text x="78" y="104" fontSize="12" fill={INK}>
        name
      </text>
      {['Ava', 'Milo'].map((name, index) => (
        <g key={name} transform={`translate(48 ${113 + index * 38})`}>
          <rect
            width="158"
            height="33"
            rx="3"
            fill={phase === index + 1 ? TEAL_LIGHT : '#eef3f2'}
          />
          <text x="8" y="22" fontSize="12" fill={INK}>
            {index + 1}
          </text>
          <text x="30" y="22" fontSize="14" fill={TEAL}>
            {name}
          </text>
        </g>
      ))}
      <Arrow x={233} y={139} width={35} />
      <rect x="289" y="81" width="190" height="113" rx="12" fill={TEAL_LIGHT} stroke={TEAL} />
      <circle cx="303" cy="137" r="4" fill="white" stroke={TEAL} />
      <text x="387" y="127" textAnchor="middle" fontSize={phase === 0 ? 17 : 29} fill={TEAL}>
        {phase === 0 ? '{{csv:name}}' : phase === 1 ? 'Ava' : 'Milo'}
      </text>
      <text x="387" y="162" textAnchor="middle" fontSize="17" fill={TEAL}>
        {phase === 0 ? '{{serial:4}}' : phase === 1 ? '0001' : '0002'}
      </text>
      <Label x={260} y={251}>
        {
          [
            'Fields in one reusable design',
            'Preview the current record and serial',
            'Advance using the chosen sequence policy',
          ][phase]
        }
      </Label>
    </g>
  );
}
