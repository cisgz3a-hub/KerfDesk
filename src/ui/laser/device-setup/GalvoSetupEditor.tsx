// Machine Setup for a JCZ galvo (ADR-704): the laser source, the lens axis
// flips and swap (MeerK40t's meanings), and the timing MeerK40t's list program
// uses. The lens field size is the bed width and height. Draft-bound: nothing
// reaches the board until the galvo panel connects and runs a program.

import {
  DEFAULT_GALVO_SETUP,
  GALVO_LASER_SOURCES,
  galvoSetupIssue,
  type GalvoLaserSource,
  type GalvoSetup,
} from '../../../core/devices/galvo-setup';

type NumericKey =
  | 'frequencyKhz'
  | 'pulseWidthNs'
  | 'jumpSpeedMmPerSec'
  | 'laserOnDelayUs'
  | 'laserOffDelayUs'
  | 'polygonDelayUs'
  | 'endDelayUs'
  | 'openMoDelayMs'
  | 'redLightSpeedMmPerSec'
  | 'redLightPortBit';

const NUMBER_FIELDS: ReadonlyArray<{
  readonly key: NumericKey;
  readonly label: string;
  readonly unit: string;
  readonly title: string;
}> = [
  {
    key: 'frequencyKhz',
    label: 'Frequency',
    unit: 'kHz',
    title: 'Q-switch (fiber) or PWM (CO2/UV) frequency an operation uses unless it sets its own.',
  },
  {
    key: 'pulseWidthNs',
    label: 'MOPA pulse width',
    unit: 'ns',
    title: 'Pulse width an operation uses unless it sets its own (MOPA sources only).',
  },
  {
    key: 'jumpSpeedMmPerSec',
    label: 'Jump speed',
    unit: 'mm/s',
    title: 'Travel speed between marks.',
  },
  {
    key: 'laserOnDelayUs',
    label: 'Laser on delay',
    unit: 'µs',
    title: 'Start delay at the beginning of each mark; negative fires early.',
  },
  {
    key: 'laserOffDelayUs',
    label: 'Laser off delay',
    unit: 'µs',
    title: 'Delay before the laser shuts off after a mark.',
  },
  {
    key: 'polygonDelayUs',
    label: 'Polygon delay',
    unit: 'µs',
    title: 'Delay at each corner between marks.',
  },
  {
    key: 'endDelayUs',
    label: 'End delay',
    unit: 'µs',
    title: 'Dwell after the last mark before the program ends.',
  },
  {
    key: 'openMoDelayMs',
    label: 'Open MO delay',
    unit: 'ms',
    title: 'Fiber only: wait after opening the master oscillator.',
  },
  {
    key: 'redLightSpeedMmPerSec',
    label: 'Red light speed',
    unit: 'mm/s',
    title: 'How fast the red pointer traces the Frame.',
  },
  {
    key: 'redLightPortBit',
    label: 'Red light output bit',
    unit: '',
    title: 'The board output the red pointer is wired to (MeerK40t default 8).',
  },
];

const SOURCE_LABELS: Readonly<Record<GalvoLaserSource, string>> = {
  fiber: 'Fiber (Q-switched)',
  mopa: 'Fiber MOPA (pulse width)',
  uv: 'UV',
  co2: 'CO2 galvo',
};

export function GalvoSetupEditor({
  value,
  onChange,
}: {
  readonly value: GalvoSetup | undefined;
  readonly onChange: (galvo: GalvoSetup) => void;
}): JSX.Element {
  const setup = value ?? DEFAULT_GALVO_SETUP;
  const change = (patch: Partial<GalvoSetup>): void => {
    const next = { ...setup, ...patch };
    if (galvoSetupIssue(next) === null) onChange(next);
  };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <p>The lens field is the bed: set Bed width and height to the field size (e.g. 110 mm).</p>
      <label>
        Laser source{' '}
        <select
          aria-label="Galvo laser source"
          value={setup.source}
          onChange={(event) => change({ source: event.target.value as GalvoLaserSource })}
        >
          {GALVO_LASER_SOURCES.map((source) => (
            <option key={source} value={source}>
              {SOURCE_LABELS[source]}
            </option>
          ))}
        </select>
      </label>
      {(['flipX', 'flipY', 'swapXY'] as const).map((flag) => (
        <label key={flag}>
          <input
            type="checkbox"
            aria-label={`Galvo ${flag}`}
            checked={setup[flag]}
            onChange={(event) => change({ [flag]: event.target.checked })}
          />{' '}
          {flag === 'swapXY' ? 'Swap X and Y' : flag === 'flipX' ? 'Flip X' : 'Flip Y'}
        </label>
      ))}
      {NUMBER_FIELDS.map((field) => (
        <label key={field.key} title={field.title}>
          {field.label}{' '}
          <input
            type="number"
            step="any"
            aria-label={`Galvo ${field.label}`}
            defaultValue={setup[field.key]}
            onChange={(event) => change({ [field.key]: Number(event.target.value) })}
            style={{ width: 96 }}
          />{' '}
          {field.unit}
        </label>
      ))}
    </div>
  );
}
